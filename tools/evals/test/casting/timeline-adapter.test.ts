// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The real casting adapter (P2-Q2 wiring): @taalcut/timeline's engine over
 * the synthetic lavfi library, profiles read from the files with
 * @taalcut/media and embedded with the deterministic stand-in. Synthetic:
 * the numbers are a regression floor, never gate criterion 2.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { timelineCastingSystem } from '../../src/adapters/casting';
import { DEFAULT_CASTING_WEIGHTS } from '../../src/adapters/synthetic-casting';
import { CASTING_FIXTURE_LIBRARY, writeCastingFixtures } from '../../src/casting/fixtures';
import { hashText, loadCastingLibrary, type LoadedLibrary } from '../../src/casting/library';
import { predictCasting, scoreCastingDirs } from '../../src/casting/run';
import { loadCastingCases } from '../../src/casting/schema';
import { testFfmpegFor } from '@taalcut/media/test-support';
import { STARTS_PROCESSES } from '../starts-processes';

// The run's FFmpeg, checked once before any file started (media's test-support-ffmpeg.ts).
const { binaries } = testFfmpegFor(inject('testFfmpeg'), 'timeline casting adapter');
const dir = mkdtempSync(join(tmpdir(), 'taalcut-cast-real-'));
let written: { libraryDir: string; labelsDir: string };
let library: LoadedLibrary;

// The library is encoded and profiled (an ffprobe per clip) once; the casting tests reuse the profiles.
beforeAll(async () => {
  if (!binaries) return;
  written = await writeCastingFixtures(dir, binaries.ffmpeg);
  library = await loadCastingLibrary(written.libraryDir, binaries);
}, STARTS_PROCESSES.timeout);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function castingSystem(variants?: number) {
  // The suite skips without FFmpeg, so this is never thrown.
  if (!binaries) throw new Error('timeline casting adapter: no FFmpeg');
  // No folders: a cast that probed the library again instead of using its profiles would fail.
  return timelineCastingSystem({
    libraries: {},
    binaries,
    profiled: [library],
    ...(variants === undefined ? {} : { variants }),
  });
}

describe('hashing embedder', () => {
  it('puts texts that share words closer than texts that share none', () => {
    const cos = (a: Float32Array, b: Float32Array) => a.reduce((sum, value, i) => sum + value * b[i]!, 0);
    const intent = hashText('wide shot of the beach and the water');
    expect(cos(intent, hashText('a blue beach and the water, slow pan'))).toBeGreaterThan(
      cos(intent, hashText('close up of a night market stall')),
    );
    expect(cos(intent, intent)).toBeCloseTo(1, 6);
  });
});

describe.skipIf(!binaries)('timeline casting adapter on the synthetic library', () => {
  it('profiles every clip from its file', () => {
    expect(library.name).toBe(CASTING_FIXTURE_LIBRARY);
    expect(library.profiles).toHaveLength(6);
    expect(library.profiles.every((profile) => profile.orientation === 'portrait')).toBe(true);
    expect(library.profiles.map((profile) => profile.range.duration.value)).toEqual([30, 20, 15, 10, 30, 30]);
  });

  it('casts with the real engine and scores as a synthetic, unclaimed report', async () => {
    const system = castingSystem();
    const cases = loadCastingCases(written.labelsDir);
    const predictions = join(dir, 'predictions');
    const [prediction] = await predictCasting(system, cases, DEFAULT_CASTING_WEIGHTS, predictions);
    const first = prediction!.variants[0]!;
    expect(first.picks.map((pick) => pick.asset)).toEqual([
      'clips/arrival.mkv',
      'clips/beach.mkv',
      'clips/step.mkv',
      'clips/end.mkv',
    ]);
    // Each pick uses the slot's length from its in-point.
    expect(first.picks.map((pick) => pick.range!.endFrame - pick.range!.startFrame)).toEqual([
      15, 15, 12, 10,
    ]);
    const report = scoreCastingDirs(written.labelsDir, predictions);
    expect(report.synthetic).toBe(true);
    expect(report.claimed).toBe(false);
    expect(report.scores.pickAcceptance).toBe(1);
    expect(report.scores.orderAcceptance).toBe(1);
  });

  it('casts a brief in story order through the formats', async () => {
    const system = castingSystem(1);
    const variants = await system.cast({
      caseId: 'brief',
      library: CASTING_FIXTURE_LIBRARY,
      template: { brief: { text: 'a day at the beach', formatId: 'vlog', targetSeconds: 6 } },
      slotCount: 0,
      weights: DEFAULT_CASTING_WEIGHTS,
      seed: 1,
    });
    expect(variants).toHaveLength(1);
    // A 6 s vlog wants more media than these 1-second clips hold: whatever is picked comes from the library.
    for (const pick of variants[0]!.picks) expect(pick.asset).toMatch(/^clips\//);
  });
});
