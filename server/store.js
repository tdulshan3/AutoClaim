import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Relocatable so a container can mount a volume over it. Defaults to
// server/data for a plain `npm start`.
const DATA_DIR = process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), 'data');

/**
 * A tiny JSON file store. Everything here is small enough (a config object, a
 * capped log) that reading and writing whole files is simpler than a database
 * and survives restarts just as well.
 */
function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

export function readJson(name, fallback) {
  ensureDir();
  const file = join(DATA_DIR, name);
  if (!existsSync(file)) return structuredClone(fallback);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // A truncated file from a hard kill shouldn't take the app down with it.
    console.warn(`[store] ${name} is unreadable, falling back to defaults`);
    return structuredClone(fallback);
  }
}

export function writeJson(name, value) {
  ensureDir();
  const file = join(DATA_DIR, name);
  const tmp = `${file}.tmp`;
  // Write-then-rename so a crash mid-write can never leave a half file behind.
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}
