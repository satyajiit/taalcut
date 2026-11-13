// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { DERIVED_KEY_PATTERN, err, FrameRate } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { beforeAll, describe, expect, it } from 'vitest';
import { createMusicGenerator } from '../../src/music/generate-track';
import { createTimeStretcher } from '../../src/stretch/select';
import { StretchFailed } from '../../src/stretch/errors';
import type { TimeStretcher } from '../../src/stretch/stretcher';
import { clickMusicProvider, clickTracker } from '../helpers/clicks';
import { testMedia } from '../helpers/ffmpeg';
import { memoryDerived, memorySink } from '../helpers/sinks';
import { makeTestTimeline, steadyBeatMap } from '../helpers/timeline';

let media: MediaContext;
let signalsmith: TimeStretcher;
let atempo: TimeStretcher;

const found = await testMedia('music grid');
if (!found.ctx) console.warn(found.skip);

beforeAll(async () => {
  if (!found.ctx) return;
  media = found.ctx;
  const s = await createTimeStretcher({ media });
  const a = await createTimeStretcher({ media, loadModule: async () => err(StretchFailed()) });
  if (!s.ok || !a.ok) throw new Error('no stretcher');
  signalsmith = s.value;
  atempo = a.value;
});

function setup(fps: number, error: (call: number) => number, stretcher = () => signalsmith) {
  const rate = fps === 30 ? FrameRate.of(30) : FrameRate.of(24);
  const timeline = makeTestTimeline({ rate, clips: [{ frames: 30 * fps }], beatMap: steadyBeatMap(120, 34) });
  const provider = clickMusicProvider(error);
  const tracker = clickTracker(media);
  const derived = memoryDerived();
  const sink = memorySink();
  const generator = createMusicGenerator({
    provider,
    sink,
    tracker,
    stretcher: stretcher(),
    derived,
    media,
    clock: { now: () => 1 },
  });
  return { timeline, provider, tracker, derived, sink, generator, frameMs: 1000 / fps };
}

describe.skipIf(!found.ctx)('generated music on the beat map (P3-V6)', () => {
  for (const fps of [30, 24])
    for (const [name, error] of [
      ['5 % slow', () => 0.95],
      ['3 % fast', () => 1.03],
    ] as const)
      it(`lands every downbeat and p95 of beats within 1 frame at ${fps} fps when generated ${name}`, async () => {
        const { timeline, generator, derived, sink, frameMs } = setup(fps, error);
        const made = await generator.generate({ timeline, mood: ['warm'] });
        expect(made.ok).toBe(true);
        if (!made.ok) return;
        expect(made.value.attempts).toBe(1);
        expect(made.value.choice.path).toBe('generated');
        expect(made.value.grid?.downbeatsOnGrid).toBe(true);
        expect(made.value.grid?.p95ErrorMs).toBeLessThanOrEqual(frameMs);
        expect(made.value.grid?.missed).toBeLessThanOrEqual(0.05);
        if (made.value.choice.path !== 'generated') return;
        expect(made.value.choice.warpedKey).toMatch(DERIVED_KEY_PATTERN);
        expect(derived.files.has(made.value.choice.warpedKey)).toBe(true);
        // The original is kept byte for byte.
        expect(sink.files.get(made.value.assetId)?.provenance.kind).toBe('generated');
      });

  it('follows a jittered tempo bar by bar', async () => {
    const { timeline, frameMs } = setup(30, () => 1);
    const generator = createMusicGenerator({
      // About 4 % slow, each bar ±2 % around that.
      provider: clickMusicProvider(() => 0.96, { barFactor: (bar) => 1 + 0.02 * Math.sin(bar * 1.7) }),
      sink: memorySink(),
      tracker: clickTracker(media),
      stretcher: signalsmith,
      derived: memoryDerived(),
      media,
      clock: { now: () => 1 },
    });
    const made = await generator.generate({ timeline });
    expect(made.ok && made.value.grid?.passed).toBe(true);
    expect(made.ok && (made.value.grid?.p95ErrorMs ?? 99) <= frameMs).toBe(true);
  });

  it('regenerates once with the tempo corrected when a provider runs 30 % fast, then succeeds', async () => {
    const { timeline, generator, provider } = setup(30, () => 1.3);
    const made = await generator.generate({ timeline });
    expect(made.ok && made.value.attempts).toBe(2);
    const second = provider.requests[1]?.plan;
    expect(second?.kind === 'chunks' && second.chunks[0]?.positiveStyles[0]).not.toBe('120 BPM');
  });

  it('gives music_off_grid with the keep-and-re-time fix after a second miss', async () => {
    const { timeline, generator, provider } = setup(30, (call) => (call === 1 ? 1.3 : 0.7));
    const made = await generator.generate({ timeline });
    expect(made.ok).toBe(false);
    if (made.ok) return;
    expect(made.error.code).toBe('audio.music_off_grid');
    expect(made.error.fix?.command).toBe('music.choosePath');
    expect(provider.requests).toHaveLength(2);
  });

  it('uses atempo only inside 0.90–1.10 when Signalsmith is missing', async () => {
    const inside = setup(
      30,
      () => 0.95,
      () => atempo,
    );
    const ok = await inside.generator.generate({ timeline: inside.timeline });
    expect(ok.ok && ok.value.grid?.passed).toBe(true);
    const outside = setup(
      30,
      () => 0.87,
      () => atempo,
    );
    const refused = await outside.generator.generate({ timeline: outside.timeline });
    expect(refused.ok ? 'ok' : refused.error.code).toBe('audio.stretch_unavailable');
  });

  it('skips the warp without a beat map: the music becomes the grid (path b)', async () => {
    const { generator, tracker } = setup(30, () => 1);
    const timeline = makeTestTimeline({ clips: [{ frames: 300 }], beatMap: null });
    const made = await generator.generate({ timeline });
    expect(made.ok && made.value.choice.path).toBe('ownTrack');
    expect(tracker.calls).toHaveLength(0);
  });
});
