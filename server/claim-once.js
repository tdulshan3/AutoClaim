/**
 * One claim pass, then exit. This is the entry point for scheduled runners
 * (GitHub Actions, cron) as opposed to `server/index.js`, which stays up and
 * ticks on a timer.
 *
 * It reuses the same guards as the long-running scheduler, so a day that's
 * already settled is skipped rather than re-claimed. That makes the workflow
 * safe to run several times a day, which matters because scheduled runners
 * fire late under load - extra runs cost nothing and buy resilience.
 */
import { getTimezone, listProfiles, profileName } from './config.js';
import { dayIn } from './dates.js';
import * as log from './log.js';
import { claimProfile } from './scheduler.js';

const GAP_MS = 2000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const timezone = getTimezone();
const day = dayIn(timezone);
const profiles = listProfiles();

console.log(`AutoClaim single run`);
console.log(`  attendance day  ${day} (${timezone})`);
console.log(`  profiles        ${profiles.length}`);

if (profiles.length === 0) {
  console.error('No profiles configured. Is the AUTOCLAIM_CONFIG secret set?');
  process.exit(1);
}

let sessionDead = false;
let first = true;

for (const profile of profiles) {
  const name = profileName(profile);

  if (!profile.autoClaim) {
    console.log(`  - ${name}: auto-claim off, skipping`);
    continue;
  }

  if (!first) await sleep(GAP_MS);
  first = false;

  const result = await claimProfile(profile.id, { kind: 'auto' });

  if (result.skipped) {
    console.log(`  - ${name}: ${result.skipped}`);
    continue;
  }

  const { outcome, message, status } = result.entry;
  console.log(`  - ${name}: ${outcome} (${status || 'no status'}) - ${message}`);

  // A rejected session is the one failure a human has to act on, so let it
  // fail the run and trigger the runner's notification. Everything else is
  // either fine or self-correcting, and failing daily on it would just train
  // you to ignore the alerts.
  if (outcome === 'auth') sessionDead = true;
}

const stats = log.stats();
console.log(`  totals          ${stats.claimed} claimed, ${stats.already} already, ${stats.unlinked} unlinked, ${stats.failed} failed`);

if (sessionDead) {
  console.error('\nA session cookie was rejected. Update the AUTOCLAIM_CONFIG secret with a fresh connect.sid.');
  process.exit(1);
}
