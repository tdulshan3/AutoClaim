import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import {
  addProfile,
  getTimezone,
  listProfiles,
  profileName,
  publicProfile,
  removeProfile,
  setTimezone,
  updateProfile,
} from './config.js';
import { dayIn } from './dates.js';
import * as log from './log.js';
import * as scheduler from './scheduler.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '127.0.0.1';

const app = express();
app.use(express.json({ limit: '64kb' }));

// async so a synchronous throw inside a handler is caught here too, rather
// than escaping to Express and rendering a stack trace as HTML.
const wrap = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    console.error('[api]', error.message);
    res.status(400).json({ error: error.message });
  }
};

const profileView = (profile) => ({
  ...publicProfile(profile),
  status: scheduler.profileStatus(profile),
});

app.get('/api/status', wrap((req, res) => {
  res.json({
    scheduler: scheduler.status(),
    profiles: listProfiles().map(profileView),
    stats: log.stats(),
  });
}));

app.post('/api/timezone', wrap((req, res) => {
  res.json({ timezone: setTimezone(req.body?.timezone) });
}));

/**
 * Add a profile. The cookie is checked against /api/auth/status straight away
 * so the account name shows up immediately and a bad paste fails loudly here
 * rather than silently at midnight.
 */
app.post('/api/profiles', wrap(async (req, res) => {
  const profile = addProfile(req.body ?? {});
  try {
    await scheduler.refreshProfile(profile.id);
  } catch (error) {
    console.error('[profiles] verify failed:', error.message);
  }
  res.json({ profile: profileView(freshProfile(profile.id)) });
}));

app.patch('/api/profiles/:id', wrap(async (req, res) => {
  const profile = updateProfile(req.params.id, req.body ?? {});
  // A changed cookie means the cached account details may belong to someone else.
  if (req.body?.connectSid !== undefined) {
    await scheduler.refreshProfile(profile.id).catch(() => {});
  }
  res.json({ profile: profileView(freshProfile(profile.id)) });
}));

app.delete('/api/profiles/:id', wrap((req, res) => {
  const removed = removeProfile(req.params.id);
  res.json({ ok: true, removed: profileName(removed) });
}));

/** Re-read the account details behind a profile's cookie. */
app.post('/api/profiles/:id/refresh', wrap(async (req, res) => {
  const profile = await scheduler.refreshProfile(req.params.id);
  res.json({ profile: profileView(profile) });
}));

/** Claim now. `force` re-sends even if the day already looks claimed. */
app.post('/api/profiles/:id/claim', wrap(async (req, res) => {
  const result = await scheduler.claimProfile(req.params.id, {
    force: Boolean(req.body?.force),
    kind: 'manual',
  });
  res.json({ ...result, profile: profileView(freshProfile(req.params.id)) });
}));

app.get('/api/logs', wrap((req, res) => {
  const { limit, outcome, profileId } = req.query;
  res.json({
    entries: log.list({
      limit: Math.min(Number(limit) || 200, 1000),
      outcome: outcome || undefined,
      profileId: profileId || undefined,
    }),
    stats: log.stats(),
  });
}));

app.delete('/api/logs', wrap((req, res) => {
  log.clear();
  res.json({ ok: true });
}));

// Re-read a profile after a mutation so the response carries fresh state.
function freshProfile(id) {
  const profile = listProfiles().find((p) => p.id === id);
  if (!profile) throw new Error('No such profile');
  return profile;
}

// In production the built React app is served from the same origin, so there's
// no CORS to think about. In dev, Vite proxies /api here instead.
const dist = join(ROOT, 'web', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(join(dist, 'index.html')));
}

// Bound to loopback on purpose: this process holds live session cookies, and
// nothing about it should be reachable from the network.
app.listen(PORT, HOST, () => {
  const timezone = getTimezone();
  const profiles = listProfiles();
  console.log(`AutoClaim on http://${HOST}:${PORT}`);
  console.log(`  timezone   ${timezone} (today is ${dayIn(timezone)})`);
  console.log(`  profiles   ${profiles.length || 'none yet - add one in the UI'}`);
  for (const profile of profiles) {
    console.log(`    - ${profileName(profile)} (${profile.serverType}, auto-claim ${profile.autoClaim ? 'on' : 'off'})`);
  }
  scheduler.start();
});
