import {
  getProfile,
  getTimezone,
  listProfiles,
  profileName,
  setProfileAccount,
} from './config.js';
import { dayIn, msUntilNextDay } from './dates.js';
import * as log from './log.js';
import { claimToday, fetchAccount } from './upstream.js';

// Rather than sleeping for 24h - which drifts, and loses its place across
// restarts - the loop wakes up often and asks "is today settled yet?" for each
// profile. The log on disk is the source of truth, so a restart resumes exactly
// where it left off.
const TICK_MS = 5 * 60 * 1000;

// A profile that keeps erroring shouldn't be retried forever. Six attempts
// spans ~30 minutes, then it waits for the next day (or a manual retry).
const MAX_ATTEMPTS_PER_DAY = 6;

// Profiles are claimed one after another with a gap, never all at once.
const GAP_BETWEEN_PROFILES_MS = 2000;

let timer = null;
let lastTickAt = null;
const inFlight = new Set();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Claim for one profile, subject to the once-a-day guards. */
export async function claimProfile(profileId, { force = false, kind = 'auto' } = {}) {
  const profile = getProfile(profileId);
  const day = dayIn(getTimezone());

  if (inFlight.has(profileId)) return { skipped: 'A claim is already running for this profile' };
  if (!force && !profile.autoClaim) return { skipped: 'Auto-claim is off for this profile' };
  if (!force && log.isSettled(profileId, day)) return { skipped: `${day} is already claimed` };
  if (!force && log.isDoneForDay(profileId, day)) {
    return { skipped: 'No game account linked, link it on xm100.vn first' };
  }
  if (!force && log.failuresToday(profileId, day) >= MAX_ATTEMPTS_PER_DAY) {
    return { skipped: `Gave up on ${day} after ${MAX_ATTEMPTS_PER_DAY} tries, will retry tomorrow` };
  }

  // The site won't credit points to an account with no game ID attached, and
  // /api/auth/status already told us whether one is. Only pre-empt when that
  // data has actually been fetched - an unrefreshed profile still gets to try.
  const account = profile.account;
  if (!force && account && !account.steamId && !account.eosId) {
    const entry = log.append({
      profileId,
      profileName: profileName(profile),
      kind,
      day,
      serverType: profile.serverType,
      outcome: 'unlinked',
      message: 'No Steam or Epic account is linked to this xm100.vn account',
      originalMessage: '',
      status: 0,
      raw: null,
    });
    console.log(`[claim] ${profileName(profile)} ${day} unlinked - skipped, nothing linked`);
    return { entry };
  }

  inFlight.add(profileId);
  try {
    const result = await claimToday(profile);
    const entry = log.append({
      profileId,
      profileName: profileName(profile),
      kind,
      day,
      serverType: profile.serverType,
      outcome: result.outcome,
      message: result.message,
      originalMessage: result.originalMessage || '',
      status: result.status,
      raw: result.raw,
    });

    // A rejected session is worth recording on the profile itself so the UI can
    // flag it without digging through the log.
    if (result.outcome === 'auth') setProfileAccount(profileId, { authOk: false });

    console.log(`[claim] ${profileName(profile)} ${day} ${entry.outcome} - ${entry.message}`);
    return { entry };
  } finally {
    inFlight.delete(profileId);
    lastTickAt = new Date().toISOString();
  }
}

/** Refresh the cached account details (name, points) for one profile. */
export async function refreshProfile(profileId) {
  const result = await fetchAccount(getProfile(profileId));
  return setProfileAccount(profileId, result);
}

async function tickAll() {
  const day = dayIn(getTimezone());

  for (const profile of listProfiles()) {
    if (!profile.autoClaim) continue;
    if (log.isDoneForDay(profile.id, day)) continue;
    if (log.failuresToday(profile.id, day) >= MAX_ATTEMPTS_PER_DAY) continue;

    await claimProfile(profile.id).catch((error) => console.error('[scheduler]', error.message));
    await sleep(GAP_BETWEEN_PROFILES_MS);
  }
  lastTickAt = new Date().toISOString();
}

export function start() {
  if (timer) return;
  timer = setInterval(() => {
    tickAll().catch((error) => console.error('[scheduler]', error));
  }, TICK_MS);
  timer.unref?.();
  // Catch up immediately on boot in case the machine was asleep past midnight.
  tickAll().catch((error) => console.error('[scheduler]', error));
}

/** Per-profile view of where today stands. */
export function profileStatus(profile) {
  const day = dayIn(getTimezone());
  return {
    day,
    settled: log.isSettled(profile.id, day),
    done: log.isDoneForDay(profile.id, day),
    todayEntry: log.lastFor(profile.id, day),
    failuresToday: log.failuresToday(profile.id, day),
    maxAttempts: MAX_ATTEMPTS_PER_DAY,
    inFlight: inFlight.has(profile.id),
    stats: log.stats(profile.id),
  };
}

export function status() {
  const timezone = getTimezone();
  return {
    today: dayIn(timezone),
    timezone,
    lastTickAt,
    tickMs: TICK_MS,
    msUntilNextDay: msUntilNextDay(timezone),
  };
}
