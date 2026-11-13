// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Checks the curated caption fonts in packages/render/fonts against
 * fonts.lock.json, and re-downloads any that are missing or differ: each
 * download goes to a fresh temp folder, is checked for its size and sha256,
 * and only then replaces the file.
 *
 *   pnpm --filter @taalcut/render fetch:fonts              # verify, fetch what is missing
 *   pnpm --filter @taalcut/render fetch:fonts --coverage   # also regenerate coverage.json
 *
 * Verifying and fetching use Node built-ins only; --coverage reads each
 * font's cmap with harfbuzzjs (a render dependency).
 */
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FONTS_DIR = join(import.meta.dirname, '..', 'fonts');
const lock = JSON.parse(await readFile(join(FONTS_DIR, 'fonts.lock.json'), 'utf8'));

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

async function current(entry) {
  try {
    const data = await readFile(join(FONTS_DIR, entry.file));
    return data.length === entry.size && sha256(data) === entry.sha256;
  } catch {
    return false;
  }
}

async function fetchVerified(entry, scratch) {
  const response = await fetch(entry.sourceUrl);
  if (!response.ok) throw new Error(`${entry.file}: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length !== entry.size)
    throw new Error(`${entry.file}: ${data.length} bytes, lock says ${entry.size}`);
  if (sha256(data) !== entry.sha256) throw new Error(`${entry.file}: sha256 differs from the lock`);
  const staged = join(scratch, entry.file);
  await writeFile(staged, data);
  await copyFile(staged, join(FONTS_DIR, entry.file));
}

/** [[start, end], …] inclusive ranges from a sorted list of code points. */
function toRanges(codepoints) {
  const ranges = [];
  for (const cp of codepoints) {
    const last = ranges[ranges.length - 1];
    if (last && cp === last[1] + 1) last[1] = cp;
    else ranges.push([cp, cp]);
  }
  return ranges;
}

/** Cap height, ascender and descender as shares of the em, from the font's first file. */
function metricsOf(hb, face) {
  const font = new hb.Font(face);
  const extents = font.hExtents();
  const round = (value) => Math.round((value / face.upem) * 10000) / 10000;
  return {
    capHeight: round(font.getMetricPositionWithFallback(hb.MetricsTag.CAP_HEIGHT)),
    ascender: round(extents.ascender),
    descender: round(-extents.descender),
  };
}

async function writeCoverage() {
  const hb = await import('harfbuzzjs');
  const byFont = new Map();
  const metrics = new Map();
  for (const entry of lock.files) {
    const data = await readFile(join(FONTS_DIR, entry.file));
    const face = new hb.Face(new hb.Blob(new Uint8Array(data)));
    const set = byFont.get(entry.fontId) ?? new Set();
    for (const cp of face.collectUnicodes()) set.add(cp);
    byFont.set(entry.fontId, set);
    if (!metrics.has(entry.fontId)) metrics.set(entry.fontId, metricsOf(hb, face));
  }
  const fonts = {};
  for (const [fontId, set] of byFont) {
    fonts[fontId] = {
      files: lock.files
        .filter((entry) => entry.fontId === fontId)
        .map((entry) => ({ file: entry.file, sha256: entry.sha256 })),
      metrics: metrics.get(fontId),
      ranges: toRanges([...set].sort((a, b) => a - b)),
    };
  }
  await writeFile(join(FONTS_DIR, 'coverage.json'), `${JSON.stringify({ version: 1, fonts })}\n`);
  process.stdout.write(`coverage.json: ${byFont.size} fonts\n`);
}

const scratch = await mkdtemp(join(tmpdir(), 'taalcut-fonts-'));
try {
  let fetched = 0;
  for (const entry of lock.files) {
    if (await current(entry)) continue;
    await fetchVerified(entry, scratch);
    fetched += 1;
    process.stdout.write(`fetched ${entry.file}\n`);
  }
  process.stdout.write(`${lock.files.length} fonts checked, ${fetched} fetched\n`);
  if (process.argv.includes('--coverage')) await writeCoverage();
} finally {
  await rm(scratch, { recursive: true, force: true });
}
