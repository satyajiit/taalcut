// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_DUCKING } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyEnvelope } from '../../src/mix/apply-envelope';
import { createDuckingPlanner } from '../../src/mix/ducking-planner';
import { decodeAudioFile } from '../../src/pcm/decode';
import { encodeFloatWav } from '../../src/pcm/pcm';
import { testMedia } from '../helpers/ffmpeg';
import { chordPad, HAS_SAY, sayToWav } from '../helpers/speech';

let media: MediaContext;
let dir: string;
let voice: string;
let pad: string;

const LINES =
  'Here is the thing nobody tells you about editing short videos. The cut matters less than the rhythm. ' +
  'Keep the voice clear, keep the music low, and let the beat carry every change of shot.';

const found = await testMedia('ducking margin');
const skip = found.ctx ? (HAS_SAY ? undefined : 'ducking margin: skipped, no macOS say') : found.skip;
if (skip) console.warn(skip);

beforeAll(async () => {
  if (skip || !found.ctx) return;
  media = found.ctx;
  dir = await mkdtemp(join(tmpdir(), 'taalcut-duck-test-'));
  voice = await sayToWav(media, dir, 'voice', LINES, { leadMs: 1500 });
  pad = await chordPad(media, dir, 16);
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe.skipIf(Boolean(skip))('ducking keeps the voice at least 8 LU above the music (P3-V6)', () => {
  it('fails before ducking, then passes on every counted 100 ms frame after the planned envelope', async () => {
    const planner = createDuckingPlanner({ media });
    const before = await planner.check({ voice, duckedMusic: pad }, 8);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.value.counted).toBeGreaterThan(20);
    expect(before.value.minMarginLu ?? 99).toBeLessThan(8);

    const pcm = await decodeAudioFile(pad, media, { sampleRate: 48_000, channels: 2 });
    if (!pcm.ok) throw new Error('decode');
    const planned = await planner.plan(
      { voice, music: pad, effects: null, durationSamples: pcm.value.channels[0]?.length ?? 0 },
      DEFAULT_DUCKING,
    );
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.value.music.length).toBeGreaterThan(2);
    expect(planned.value.effects).toEqual([]);
    for (const point of planned.value.music) expect(point.db).toBeGreaterThanOrEqual(DEFAULT_DUCKING.floorDb);

    const ducked = join(dir, 'ducked.wav');
    await writeFile(ducked, encodeFloatWav(applyEnvelope(pcm.value, planned.value.music)));
    const after = await planner.check({ voice, duckedMusic: ducked }, 8);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.counted).toBe(before.value.counted);
    expect(after.value.passed).toBe(true);
    expect(after.value.minMarginLu ?? 0).toBeGreaterThanOrEqual(8);
  });

  it('plans nothing when ducking is off or there is nothing under the voice', async () => {
    const planner = createDuckingPlanner({ media });
    const off = await planner.plan(
      { voice, music: pad, effects: null, durationSamples: 48_000 },
      { ...DEFAULT_DUCKING, enabled: false },
    );
    expect(off.ok && off.value).toEqual({ music: [], effects: [] });
    const none = await planner.plan(
      { voice, music: null, effects: null, durationSamples: 48_000 },
      DEFAULT_DUCKING,
    );
    expect(none.ok && none.value).toEqual({ music: [], effects: [] });
  });

  it('gives sound effects the same envelope as the music', async () => {
    const planner = createDuckingPlanner({ media });
    const both = await planner.plan(
      { voice, music: pad, effects: pad, durationSamples: 16 * 48_000 },
      DEFAULT_DUCKING,
    );
    expect(both.ok && both.value.effects).toEqual(both.ok && both.value.music);
  });
});
