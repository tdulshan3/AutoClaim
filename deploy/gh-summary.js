/**
 * Renders the claim log as markdown for a GitHub Actions run summary.
 *
 * A scheduled runner has no always-on UI, so this is the "did it work?" view
 * you get from a phone without cloning anything: it shows up on the workflow
 * run page itself.
 */
import { readFileSync } from 'node:fs';

const dataDir = process.env.DATA_DIR || 'server/data';

let entries = [];
try {
  entries = JSON.parse(readFileSync(`${dataDir}/log.json`, 'utf8'));
} catch {
  console.log('No log yet.');
  process.exit(0);
}

const ICON = {
  claimed: '✅',
  already: '☑️',
  unlinked: '⚠️',
  failed: '❌',
  auth: '🔑',
};

const today = entries[0]?.day ?? '';
const todays = entries.filter((e) => e.day === today);

const lines = [];
lines.push(`## AutoClaim — ${today}`, '');

if (todays.length) {
  lines.push('| | Profile | Outcome | Detail |', '| --- | --- | --- | --- |');
  for (const e of todays) {
    const detail = (e.message || '').replace(/\|/g, '\\|');
    lines.push(`| ${ICON[e.outcome] || '•'} | ${e.profileName} | \`${e.outcome}\` | ${detail} |`);
  }
} else {
  lines.push('_Nothing recorded for today._');
}

lines.push('', '<details><summary>Recent history</summary>', '');
lines.push('| Day | Profile | Outcome | Detail |', '| --- | --- | --- | --- |');
for (const e of entries.slice(0, 30)) {
  const detail = (e.message || '').replace(/\|/g, '\\|');
  lines.push(`| ${e.day} | ${e.profileName} | ${ICON[e.outcome] || ''} ${e.outcome} | ${detail} |`);
}
lines.push('', '</details>');

console.log(lines.join('\n'));
