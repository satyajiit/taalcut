// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSyntheticClips, syntheticSearchSystem } from '../../src/adapters/synthetic-search';
import { bundledFfmpeg } from '../../src/ffmpeg-bin';
import { runFfmpeg } from '../../src/ffmpeg-run';
import { readJson } from '../../src/files';
import { syntheticSearchClips, syntheticSearchQueries, writeSearchFixtures } from '../../src/search/fixtures';
import { predictSearch, scoreSearch } from '../../src/search/run';
import { loadSearchPredictions } from '../../src/search/schema';
import { STARTS_PROCESSES } from '../starts-processes';

const bins = bundledFfmpeg();
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('search fixtures', () => {
  // Two FFmpeg runs: the library (one run writes all 12 clips) and a decode of one clip.
  it.skipIf(bins === undefined)(
    'builds a 12-clip library and a perfect synthetic score',
    STARTS_PROCESSES,
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'taalcut-search-fix-'));
      dirs.push(dir);
      const ffmpeg = bins?.ffmpeg;
      if (ffmpeg === undefined) return;
      const written = await writeSearchFixtures(dir, ffmpeg);
      const manifest = readJson(join(written.libraryDir, 'manifest.json')) as {
        clips: unknown;
        synthetic: boolean;
      };
      expect(manifest.synthetic).toBe(true);
      const clips = parseSyntheticClips(manifest.clips);
      expect(clips).toHaveLength(12);
      const raw = await runFfmpeg(ffmpeg, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        join(written.libraryDir, 'clips/en-market.mkv'),
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        'pipe:1',
      ]);
      expect(raw.length).toBe(64 * 32 * 3 * 5);
      expect(raw.includes(255)).toBe(true);
      const out = join(dir, 'predictions');
      await predictSearch(syntheticSearchSystem(clips), written.labelsDir, out);
      const report = scoreSearch(syntheticSearchQueries(), loadSearchPredictions(out));
      expect(report.queries).toHaveLength(8);
      expect(report.gate.pass).toBe(true);
      expect(report.synthetic).toBe(true);
      expect(report.claimed).toBe(false);
      expect(syntheticSearchClips()).toHaveLength(12);
    },
  );
});
