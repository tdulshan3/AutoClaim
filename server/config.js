import { randomUUID } from 'node:crypto';
import { readJson, writeJson } from './store.js';

const FILE = 'config.json';
const DEFAULTS = { timezone: 'Asia/Ho_Chi_Minh', profiles: [] };

let cache = null;

/**
 * The connect.sid can arrive in three shapes depending on where it was copied
 * from. Devtools shows the decoded value (`s:abc.def`), the wire format is
 * percent-encoded (`s%3Aabc.def`), and copying a whole row gives the pair.
 * Normalise to the wire format so all three paste cleanly.
 */
export function normaliseCookie(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';

  value = value.replace(/^connect\.sid\s*[=:]\s*/i, '').trim();
  // Drop a trailing "; Path=/; HttpOnly" if a whole Set-Cookie got pasted.
  value = value.split(';')[0].trim();
  value = value.replace(/^["']|["']$/g, '');

  if (value.startsWith('s:')) return `s%3A${encodeURIComponent(value.slice(2))}`;
  return value;
}

/** Never send a full cookie to the browser - it's a live credential. */
export function maskCookie(value) {
  if (!value) return '';
  const decoded = decodeURIComponent(value);
  return decoded.length <= 12 ? '••••' : `${decoded.slice(0, 6)}…${decoded.slice(-6)}`;
}

function load() {
  if (!cache) {
    cache = { ...DEFAULTS, ...readJson(FILE, {}) };
    if (process.env.CLAIM_TIMEZONE) cache.timezone = process.env.CLAIM_TIMEZONE;

    // Seed a first profile from the environment, but only when there are none -
    // a stale .env must never clobber profiles managed through the UI.
    if (cache.profiles.length === 0 && process.env.CONNECT_SID) {
      cache.profiles.push(makeProfile({
        connectSid: process.env.CONNECT_SID,
        serverType: process.env.SERVER_TYPE || 'ase',
      }));
    }
    persist();
  }
  return cache;
}

function persist() {
  writeJson(FILE, cache);
}

function makeProfile({ connectSid, serverType = 'ase', label = '' }) {
  return {
    id: randomUUID(),
    label,
    connectSid: normaliseCookie(connectSid),
    serverType,
    autoClaim: true,
    account: null, // filled in from /api/auth/status
    authOk: null,
    addedAt: new Date().toISOString(),
  };
}

export function getTimezone() {
  return load().timezone;
}

export function setTimezone(timezone) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
  } catch {
    throw new Error(`Unknown timezone: ${timezone}`);
  }
  load().timezone = timezone;
  persist();
  return timezone;
}

export function listProfiles() {
  return load().profiles;
}

export function getProfile(id) {
  const profile = load().profiles.find((p) => p.id === id);
  if (!profile) throw new Error('No such profile');
  return profile;
}

export function addProfile({ connectSid, serverType, label }) {
  const cookie = normaliseCookie(connectSid);
  if (!cookie) throw new Error('A session cookie is required');

  const config = load();
  if (config.profiles.some((p) => p.connectSid === cookie)) {
    throw new Error('That session cookie is already on a profile');
  }

  const profile = makeProfile({ connectSid: cookie, serverType, label });
  config.profiles.push(profile);
  persist();
  return profile;
}

export function updateProfile(id, patch) {
  const profile = getProfile(id);

  if (patch.connectSid !== undefined) {
    profile.connectSid = normaliseCookie(patch.connectSid);
    // A new cookie invalidates what we knew about the account.
    profile.authOk = null;
  }
  if (patch.label !== undefined) profile.label = String(patch.label).slice(0, 60);
  if (patch.serverType !== undefined) profile.serverType = String(patch.serverType);
  if (patch.autoClaim !== undefined) profile.autoClaim = Boolean(patch.autoClaim);

  persist();
  return profile;
}

export function removeProfile(id) {
  const config = load();
  const index = config.profiles.findIndex((p) => p.id === id);
  if (index === -1) throw new Error('No such profile');
  const [removed] = config.profiles.splice(index, 1);
  persist();
  return removed;
}

/** Cache what /api/auth/status told us about this account. */
export function setProfileAccount(id, { authOk, account }) {
  const profile = getProfile(id);
  profile.authOk = authOk;
  if (account) {
    profile.account = { ...account, checkedAt: new Date().toISOString() };
    // An unnamed profile takes the account's username; the nickname is shown
    // underneath it rather than in place of it.
    if (!profile.label) profile.label = account.username || account.nickname || '';
  }
  persist();
  return profile;
}

/** The display name to use for a profile, in the log and the UI. */
export function profileName(profile) {
  return profile.label || profile.account?.username || 'Unnamed profile';
}

/** The shape that's safe to hand to the frontend - no raw cookie. */
export function publicProfile(profile) {
  return {
    id: profile.id,
    label: profile.label,
    name: profileName(profile),
    serverType: profile.serverType,
    autoClaim: profile.autoClaim,
    authOk: profile.authOk,
    tokenPreview: maskCookie(profile.connectSid),
    account: profile.account,
    addedAt: profile.addedAt,
  };
}
