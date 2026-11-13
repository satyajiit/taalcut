// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-D1: a small scripted clip made for real (OpenH264, no VideoToolbox), its labels checked against its pixels
 * by FFmpeg's blackdetect with the analysis pass's rule (d=0): the fade's black lies inside the fade's label, the
 * cut to black and back is black exactly between its two cuts, and the low-key shot's black never leaves it.
 * Needs the bundled FFmpeg; skips without it (run it under the encoder lock).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSet } from '../src/generate';
import type { Manifest } from '../src/manifest';
import type { FootageSet } from '../src/sets/types';
import { bundledFfmpeg, systemTools } from '../src/tools';
import { STARTS_PROCESSES } from './starts-processes';

const SCRIPTED: FootageSet = {
  name: 'fades-tiny',
  version: 1,
  seed: 11,
  looksProbe: 'fractal',
  clips: [
    {
      file: 'fades-tiny.mp4',
      ...{ width: 320, height: 180, fps: 30, codec: 'h264', bitrate: '1M', seconds: 12.1, bed: 'none' },
      createdAt: '2026-10-20T08:00:00Z',
      speech: null,
      onScreen: [],
      bars: false,
      script: [
        { look: 'pattern', seconds: 2 },
        { look: 'fractal', seconds: 2, entry: { kind: 'fade', out: 0.5, hold: 0.5, in: 0.5 } },
        { look: 'gradient', seconds: 2, entry: { kind: 'fade', out: 0, hold: 0.6, in: 0 } },
        { look: 'fractal', seconds: 3, dark: true },
        { look: 'cells', seconds: 2 },
      ],
    },
  ],
};

const ffmpeg = bundledFfmpeg() ?? '';
let root = '';
let manifest: Manifest | undefined;

beforeAll(async () => {
  if (ffmpeg === '') return;
  root = mkdtempSync(join(tmpdir(), 'taalcut-fades-footage-'));
  manifest = await generateSet(
    SCRIPTED,
    join(root, 'set'),
    systemTools(ffmpeg, { reportDir: join(root, 'stalls') }),
  );
}, 120_000);
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

/** blackdetect's runs over the file at the pass's rule: every run, FFmpeg's thresholds. */
function blackRuns(file: string): [number, number][] {
  // blackdetect logs its runs on stderr.
  const run = spawnSync(
    ffmpeg,
    ['-hide_banner', '-nostats', '-i', file, '-vf', 'blackdetect=d=0', '-an', '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  if (run.status !== 0) throw new Error(`blackdetect failed: ${run.stderr}`);
  return [...run.stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
}

describe.skipIf(ffmpeg === '')('a scripted clip’s labels against its pixels', STARTS_PROCESSES, () => {
  it('has its black where the labels say', () => {
    const clip = manifest?.clips[0];
    expect(clip?.cuts).toEqual([
      { at: 1.5, kind: 'fade', seconds: 1.5 },
      { at: 4.5, kind: 'cut', seconds: 0 },
      { at: 5.1, kind: 'cut', seconds: 0 },
      { at: 7.1, kind: 'cut', seconds: 0 },
      { at: 10.1, kind: 'cut', seconds: 0 },
    ]);
    expect(clip?.shots.map((shot) => shot.dark === true)).toEqual([false, false, false, true, false]);
    const runs = blackRuns(join(root, 'set', 'fades-tiny.mp4'));
    const frame = 1 / 30;
    // The fade: one run holding the 0.5 s of black, inside the fade's 1.5 s.
    const fade = runs.filter(([start]) => start < 3);
    expect(fade).toHaveLength(1);
    const [fadeStart = 0, fadeEnd = 0] = fade[0] ?? [];
    expect(fadeStart).toBeGreaterThanOrEqual(1.5);
    expect(fadeStart).toBeLessThanOrEqual(2);
    expect(fadeEnd).toBeGreaterThanOrEqual(2.5);
    expect(fadeEnd).toBeLessThanOrEqual(3);
    // The cut to black and back: black exactly between the two cuts.
    const interstitial = runs.filter(([start]) => start >= 3 && start < 6);
    expect(interstitial).toHaveLength(1);
    expect(Math.abs((interstitial[0]?.[0] ?? 0) - 4.5)).toBeLessThanOrEqual(frame + 1e-6);
    expect(Math.abs((interstitial[0]?.[1] ?? 0) - 5.1)).toBeLessThanOrEqual(frame + 1e-6);
    // The low-key shot drifts into black (night footage) and its black never leaves it.
    const dark = runs.filter(([start]) => start >= 6);
    expect(dark.length).toBeGreaterThan(0);
    for (const [start, end] of dark) {
      expect(start).toBeGreaterThanOrEqual(7.1 - 1e-6);
      expect(end).toBeLessThanOrEqual(10.1 + 1e-6);
    }
  });
});
