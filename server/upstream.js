const BASE = 'https://xm100.vn';
const TIMEOUT_MS = 20_000;

/**
 * Strip Vietnamese diacritics so phrase matching survives whatever encoding
 * the API answers in. `đ` is a distinct letter, not a combining mark, so it
 * needs its own pass.
 */
function flatten(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/**
 * The API answers in Vietnamese. Longest patterns first so "da diem danh hom
 * nay" wins over the bare "diem danh". Anything unrecognised is passed through
 * untouched rather than mangled, and the original is kept alongside it.
 */
const TRANSLATIONS = [
  ['chua lien ket tai khoan steam', 'You have not linked a Steam account'],
  ['chua lien ket tai khoan epic', 'You have not linked an Epic account'],
  ['chua lien ket tai khoan', 'You have not linked a game account'],
  ['chua lien ket', 'Account not linked'],
  ['ban da diem danh hom nay', 'You already checked in today'],
  ['ban da diem danh roi', 'You already checked in'],
  ['da diem danh hom nay', 'Already checked in today'],
  ['khong the diem danh lai', "Can't check in again"],
  ['diem danh thanh cong', 'Checked in successfully'],
  ['phien dang nhap het han', 'Session expired'],
  ['vui long dang nhap', 'Please log in'],
  ['ban chua dang nhap', 'You are not logged in'],
  ['chua dang nhap', 'Not logged in'],
  ['khong tim thay', 'Not found'],
  ['da diem danh', 'Already checked in'],
  ['nhan thanh cong', 'Received successfully'],
  ['da nhan roi', 'Already received'],
  ['diem danh', 'Check-in'],
  ['thanh cong', 'Success'],
  ['that bai', 'Failed'],
  ['loi he thong', 'System error'],
];

export function toEnglish(message) {
  if (!message) return '';
  const flat = flatten(message);
  const hit = TRANSLATIONS.find(([vietnamese]) => flat.includes(vietnamese));
  return hit ? hit[1] : message;
}

const ALREADY_PHRASES = [
  'already',
  'da diem danh',
  'diem danh roi',
  'da nhan',
  'da bao danh',
  'duoc nhan roi',
  'khong the diem danh lai',
];

// The site refuses to credit points until a game account is linked on your
// xm100.vn profile. Retrying can never fix that, so it gets its own outcome
// and stops the day rather than burning the retry budget.
const UNLINKED_PHRASES = ['chua lien ket', 'not linked', 'chua ket noi'];

const AUTH_PHRASES = [
  'unauthorized',
  'unauthenticated',
  'not logged in',
  'chua dang nhap',
  'phien dang nhap',
  'vui long dang nhap',
];

/**
 * Work out what actually happened. The API's exact contract isn't documented
 * here, so this leans on status codes first and phrasing second, and always
 * keeps the raw body in the log so a wrong guess is visible rather than silent.
 */
function classify(status, body, text) {
  const haystack = flatten(typeof text === 'string' ? text : JSON.stringify(body ?? ''));
  const said = (phrases) => phrases.some((p) => haystack.includes(p));

  if (status === 401 || status === 403) return { outcome: 'auth', message: 'Session rejected' };

  // The site answers an unauthenticated request with a 200 and
  // {"authenticated":false}, which would otherwise sail through the success
  // path below and be recorded as a claim that never happened.
  if (body && body.authenticated === false) {
    return { outcome: 'auth', message: 'Session is not authenticated' };
  }

  // Some sites answer 200 with a login page instead of a 401.
  if (/<!doctype html|<html/i.test(text || '')) {
    return { outcome: 'auth', message: 'Got an HTML page instead of JSON, the session has expired' };
  }

  const raw = pickMessage(body);
  const english = toEnglish(raw);

  // Checked before the generic failure paths: this one is about the account,
  // not the request, and no amount of retrying changes it.
  if (said(UNLINKED_PHRASES)) {
    return { outcome: 'unlinked', message: english || 'No game account linked', originalMessage: raw };
  }

  if (said(ALREADY_PHRASES)) {
    return { outcome: 'already', message: english || 'Already claimed for this day', originalMessage: raw };
  }

  if (status >= 200 && status < 300) {
    // An explicit failure flag beats a 200.
    const failed = body && (body.success === false || body.ok === false || body.error);
    if (!failed) return { outcome: 'claimed', message: english || 'Claimed', originalMessage: raw };
    if (said(AUTH_PHRASES)) return { outcome: 'auth', message: english || 'Session rejected', originalMessage: raw };
    return { outcome: 'failed', message: english || 'Server refused the claim', originalMessage: raw };
  }

  if (said(AUTH_PHRASES)) return { outcome: 'auth', message: english || 'Session rejected', originalMessage: raw };
  return { outcome: 'failed', message: english || `HTTP ${status}`, originalMessage: raw };
}

function pickMessage(body) {
  if (!body || typeof body !== 'object') return '';
  for (const key of ['message', 'msg', 'error', 'detail', 'reason']) {
    if (typeof body[key] === 'string' && body[key].trim()) return body[key].trim();
  }
  return '';
}

async function call(profile, method, path, payload) {
  if (!profile?.connectSid) {
    return { outcome: 'auth', message: 'No session cookie on this profile', status: 0, raw: null };
  }

  let response;
  let text = '';
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Accept: 'application/json, text/plain, */*',
        Cookie: `connect.sid=${profile.connectSid}`,
        Origin: BASE,
        Referer: `${BASE}/`,
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    text = await response.text();
  } catch (error) {
    const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
    return {
      outcome: 'failed',
      message: timedOut ? `No response within ${TIMEOUT_MS / 1000}s` : `Network error: ${error.message}`,
      status: 0,
      raw: null,
    };
  }

  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Leave body null, classify() falls back to the raw text.
  }

  return {
    ...classify(response.status, body, text),
    status: response.status,
    body,
    // Cap it - a stray HTML error page shouldn't bloat the log file.
    raw: text.length > 1500 ? `${text.slice(0, 1500)}…` : text,
  };
}

/** Claim today's attendance for one profile. */
export function claimToday(profile) {
  return call(profile, 'POST', '/api/attendance/claim', { serverType: profile.serverType });
}

/**
 * Who does this cookie belong to? Read-only, and the only way to put a name and
 * a point balance against a profile.
 */
export async function fetchAccount(profile) {
  const result = await call(profile, 'GET', '/api/auth/status');
  const user = result.body?.user;

  if (!result.body?.authenticated || !user) {
    return {
      authOk: false,
      account: null,
      // Deliberately not result.message: a 200 with authenticated:false used to
      // surface here as the word "Claimed", which reads as the opposite of what
      // it means.
      message: 'This session cookie is no longer valid, paste a fresh one',
      status: result.status,
    };
  }

  return {
    authOk: true,
    status: result.status,
    account: {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      email: user.email,
      avatar: user.avatar,
      discordId: user.discord_id,
      points: user.points,
      asaPoints: user.asa_points,
      xcoin: user.xcoin,
      role: user.role,
      // The game account the points are actually delivered to. An account can
      // be linked through Steam, through Epic (EOS), or neither.
      steamId: user.steam_id || null,
      eosId: user.eos_id || null,
      vipAse: user.vip_details_ase?.level || null,
      vipAsa: user.vip_details_asa?.level || null,
    },
  };
}
