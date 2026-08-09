import { readJson, writeJson } from './store.js';

const FILE = 'log.json';
const MAX_ENTRIES = 1000;

let cache = null;

function all() {
  if (!cache) cache = readJson(FILE, []);
  return cache;
}

/**
 * @param {object} entry
 * @param {string}  entry.profileId      which account this was for
 * @param {string}  entry.profileName    denormalised so old rows still read
 *                                       correctly after a rename or delete
 * @param {'auto'|'manual'} entry.kind   what triggered it
 * @param {string}  entry.day            the attendance day being claimed
 * @param {'claimed'|'already'|'failed'|'auth'} entry.outcome
 */
export function append(entry) {
  const entries = all();
  const record = {
    id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    at: new Date().toISOString(),
    ...entry,
  };
  entries.unshift(record);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  writeJson(FILE, entries);
  return record;
}

export function list({ limit = 200, outcome, profileId } = {}) {
  let entries = all();
  if (outcome) entries = entries.filter((e) => e.outcome === outcome);
  if (profileId) entries = entries.filter((e) => e.profileId === profileId);
  return entries.slice(0, limit);
}

export function clear() {
  cache = [];
  writeJson(FILE, cache);
}

/**
 * Has this profile's day been dealt with? "already" counts as settled - the
 * server telling us we've claimed is just as final as claiming ourselves.
 */
export function isSettled(profileId, day) {
  return all().some(
    (e) => e.profileId === profileId && e.day === day && (e.outcome === 'claimed' || e.outcome === 'already'),
  );
}

/**
 * Nothing further will be attempted for this profile today. Broader than
 * isSettled: an unlinked account hasn't claimed anything, but retrying it is
 * pointless until the account is linked on the website.
 */
export function isDoneForDay(profileId, day) {
  return all().some(
    (e) =>
      e.profileId === profileId &&
      e.day === day &&
      (e.outcome === 'claimed' || e.outcome === 'already' || e.outcome === 'unlinked'),
  );
}

export function lastFor(profileId, day) {
  return all().find((e) => e.profileId === profileId && e.day === day) || null;
}

/** Failed attempts for this profile today, used to back off. */
export function failuresToday(profileId, day) {
  return all().filter(
    (e) => e.profileId === profileId && e.day === day && (e.outcome === 'failed' || e.outcome === 'auth'),
  ).length;
}

export function stats(profileId) {
  const entries = profileId ? all().filter((e) => e.profileId === profileId) : all();
  return {
    total: entries.length,
    claimed: entries.filter((e) => e.outcome === 'claimed').length,
    already: entries.filter((e) => e.outcome === 'already').length,
    unlinked: entries.filter((e) => e.outcome === 'unlinked').length,
    failed: entries.filter((e) => e.outcome === 'failed' || e.outcome === 'auth').length,
  };
}
