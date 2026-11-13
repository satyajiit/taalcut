// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * blackFrames, frozenFrames and blackBars on fixtures made with the bundled
 * FFmpeg, measured by the one video pass (the machine's hardware decode: VideoToolbox, NVDEC).
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ComputeFallbackEvent } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import {
  blackBarsCheck,
  blackFramesCheck,
  frozenFramesCheck,
  type SegmentPasses,
  type SourceStillness,
} from '../../src/qa/checks/video';
import { runVideoPass, type VideoPass } from '../../src/qa/measure/video-pass';
import { sourceStillness } from '../../src/qa/passes/source-stillness';
import { ffmpeg, findTestMedia, mediaContext, tempDir } from '../support/media';
import { hostVideo } from '../support/host-video';
import { refusingHardware } from '../support/refusing';
import { PASS_VIDEO, qaPlan, rate30 } from './support';

const media = await findTestMedia('qa picture');
const SIZE = 's=540x960:r=30';

describe.skipIf(!media.binaries)('picture checks', () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  const passes = new Map<string, VideoPass>();
  const path = (name: string) => join(work.dir, `${name}.mp4`);
  const encode = (name: string, graph: string) =>
    ffmpeg(ctx, ['-filter_complex', graph, ...PASS_VIDEO, '-an', path(name)]);
  const measure = async (name: string): Promise<VideoPass> => {
    const cached = passes.get(name);
    if (cached) return cached;
    const result = await runVideoPass(ctx, path(name), { rate: rate30 });
    if (!result.ok) throw new Error(`${result.error.code} ${result.error.detail ?? ''}`);
    passes.set(name, result.value);
    return result.value;
  };
  const lossless = (name: string) => join(work.dir, `${name}.mkv`);
  /** The named file as the clip's conformed segment, starting on render frame 0. */
  const segmentFrom =
    (name: string): SegmentPasses =>
    async () => ({ pass: await measure(name), startFrame: 0 });
  /** The named file as the clip's conformed segment, shown whole from render frame 0, asked about a freeze. */
  const stillnessOf = (file: string): SourceStillness =>
    sourceStillness(ctx, new Map([['clip-a', { path: file, startFrame: 0 }]]), () => ({ kind: 'whole' }), {
      rate: rate30,
    });

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('qa-picture');
    await encode('moving', `testsrc2=${SIZE}:d=2`);
    await encode(
      'blackMiddle',
      `testsrc2=${SIZE}:d=1[a];color=c=black:${SIZE}:d=0.5[b];testsrc2=${SIZE}:d=1[c];[a][b][c]concat=n=3:v=1:a=0`,
    );
    await encode(
      'blackOpening',
      `color=c=black:${SIZE}:d=0.2[a];testsrc2=${SIZE}:d=1.8[b];[a][b]concat=n=2:v=1:a=0`,
    );
    // Frame 45 held for 30 more frames: a one-second freeze the render made.
    await encode('frozen', `testsrc2=${SIZE}:d=2,loop=loop=30:size=1:start=45`);
    // A still picture, exactly (lossless), and the same still stepping one level of luma and of chroma every
    // 8 frames: what a busy Mac's VideoToolbox made of the brand test's magenta intro (UX2 round 3).
    const still = 'color=c=0xff00ff:s=540x960:r=30:d=2,format=yuv420p';
    await ffmpeg(ctx, ['-filter_complex', still, '-c:v', 'ffv1', '-an', lossless('still')]);
    const step = 'mod(floor(N/8),2)';
    await ffmpeg(ctx, [
      '-filter_complex',
      `${still},geq=lum='lum(X,Y)+${step}':cb='cb(X,Y)':cr='cr(X,Y)+${step}'`,
      ...['-c:v', 'ffv1', '-an', lossless('flicker')],
    ]);
    // A landscape shot letterboxed into the portrait frame.
    await encode('letterboxed', `testsrc2=s=540x304:r=30:d=2,pad=540:960:0:328:black`);
  });
  afterAll(() => work.dispose());

  it('passes moving footage on all three checks, decoding on the GPU first', async () => {
    const pass = await measure('moving');
    expect(pass.frames).toBe(60);
    // The machine's first decoding row (VideoToolbox, NVDEC), or the CPU on a machine with none.
    expect(pass.backend).toBe((await hostVideo(ctx)).decode ?? 'cpu');
    expect(pass.analysisSize).toEqual({ width: 270, height: 480 });
    const plan = qaPlan();
    expect((await blackFramesCheck(pass, plan)).status).toBe('pass');
    expect((await frozenFramesCheck(pass, plan)).status).toBe('pass');
    expect(blackBarsCheck(pass, plan).status).toBe('pass');
  });

  it('reports a software decode as a compute fallback and measures the same', async () => {
    const events: ComputeFallbackEvent[] = [];
    const onFallback = vi.fn((event: ComputeFallbackEvent) => events.push(event));
    const result = await runVideoPass(ctx, path('moving'), { rate: rate30, decode: 'software', onFallback });
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.backend).toBe('cpu');
    expect(events).toEqual([
      expect.objectContaining({ operation: 'render.qaVideoDecode', reason: 'disabled' }),
    ]);
    expect(result.value.frames).toBe((await measure('moving')).frames);
    expect(result.value.black).toEqual([]);
  });

  it('decodes once more in software when the hardware decoder refuses, reported as accelerator_failed', async (test) => {
    if (!(await hostVideo(ctx)).decode) return test.skip();
    const refusing = refusingHardware();
    const events: ComputeFallbackEvent[] = [];
    const result = await runVideoPass({ ...ctx, runner: refusing.runner }, path('moving'), {
      rate: rate30,
      onFallback: (event) => events.push(event),
    });
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.backend).toBe('cpu');
    expect(events).toEqual([
      expect.objectContaining({
        operation: 'render.qaVideoDecode',
        reason: 'accelerator_failed',
        detail: expect.stringMatching(/(videotoolbox_vld|cuda) decoder would not start/),
      }),
    ]);
    expect(refusing.calls.map((args) => args.includes('-hwaccel'))).toEqual([true, false]);
    expect(result.value.frames).toBe((await measure('moving')).frames);
  });

  describe('blackFrames', () => {
    it('finds half a second of black and fails it with a re-render', async () => {
      const pass = await measure('blackMiddle');
      expect(pass.black).toEqual([{ start: 30, end: 45 }]);
      const result = await blackFramesCheck(pass, qaPlan({ durationFrames: 75 }));
      expect(result.status).toBe('fail');
      expect(result.measured).toEqual({ value: 15, unit: 'frames' });
      expect(result.findings).toEqual([
        { frames: { start: 30, end: 45 }, target: { kind: 'clip', id: 'clip-a' } },
      ]);
      expect(result.fixes).toEqual([{ kind: 'auto', action: 'rerender' }]);
    });

    it('passes black the timeline asks for (a gap or a dip)', async () => {
      const plan = qaPlan({ durationFrames: 75, intendedDark: [{ start: 30, end: 45 }] });
      expect((await blackFramesCheck(await measure('blackMiddle'), plan)).status).toBe('pass');
    });

    it("asks the agent to swap or trim when the clip's own footage is dark there", async () => {
      const result = await blackFramesCheck(
        await measure('blackMiddle'),
        qaPlan({ durationFrames: 75 }),
        segmentFrom('blackMiddle'),
      );
      expect(result.status).toBe('fail');
      expect(result.fixes).toEqual([
        { kind: 'agent', instructionKey: 'qa.fixes.swapOrTrimDark', params: { clipId: 'clip-a' } },
      ]);
    });

    it('fails a black opening frame even when the timeline asks for it', async () => {
      const pass = await measure('blackOpening');
      expect(pass.black).toEqual([{ start: 0, end: 6 }]);
      const result = await blackFramesCheck(pass, qaPlan({ intendedDark: [{ start: 0, end: 6 }] }));
      expect(result.status).toBe('fail');
      expect(result.findings[0]?.target).toEqual({ kind: 'file', id: 'openingFrame' });
      expect(result.fixes).toEqual([
        { kind: 'agent', instructionKey: 'qa.fixes.openOnPicture', params: { frames: 6 } },
      ]);
    });
  });

  describe('frozenFrames', () => {
    const plan = qaPlan({ durationFrames: 90 });

    it('finds the held frame', async () => {
      const pass = await measure('frozen');
      expect(pass.frames).toBe(90);
      expect(pass.freezes).toHaveLength(1);
      // freezedetect starts a freeze at the last frame that still matches: testsrc2's frame 44 is that close to 45.
      expect(pass.freezes[0]!.start).toBeGreaterThanOrEqual(44);
      expect(pass.freezes[0]!.start).toBeLessThanOrEqual(45);
      expect(pass.freezes[0]!.end).toBeGreaterThanOrEqual(75);
    });

    it('fails a freeze the source segment does not have: the render made it', async () => {
      const result = await frozenFramesCheck(await measure('frozen'), plan, stillnessOf(path('moving')));
      expect(result.status).toBe('fail');
      expect(result.fixes).toEqual([{ kind: 'auto', action: 'rerender' }]);
    });

    it('warns on a freeze the footage itself has', async () => {
      const result = await frozenFramesCheck(await measure('frozen'), plan, stillnessOf(path('frozen')));
      expect(result.status).toBe('warn');
      expect(result.fixes).toEqual([
        { kind: 'agent', instructionKey: 'qa.fixes.swapOrTrimStatic', params: { clipId: 'clip-a' } },
      ]);
    });

    it("credits the footage when its segment only flickers a level, as a busy Mac's re-encode of a still does", async () => {
      // At the render's tolerance (−50 dB) a one-level step in luma and chroma reads as motion…
      const atRender = await runVideoPass(ctx, lossless('flicker'), { rate: rate30 });
      expect(atRender.ok && atRender.value.freezes).toEqual([]);
      const output = await runVideoPass(ctx, lossless('still'), { rate: rate30 });
      if (!output.ok) throw new Error(output.error.code);
      expect(output.value.freezes).toEqual([{ start: 0, end: 60 }]);
      // …the segment, at the footage's tolerance, holds the still the footage is: a warning, not the render.
      const result = await frozenFramesCheck(
        output.value,
        qaPlan({ durationFrames: 60 }),
        stillnessOf(lossless('flicker')),
      );
      expect(result.status).toBe('warn');
      expect(result.fixes).toEqual([
        { kind: 'agent', instructionKey: 'qa.fixes.swapOrTrimStatic', params: { clipId: 'clip-a' } },
      ]);
    });

    it('passes a hold the timeline asks for, ignoring a frame of freeze just before it', async () => {
      const held = qaPlan({ durationFrames: 90, intendedStatic: [{ start: 45, end: 90 }] });
      expect((await frozenFramesCheck(await measure('frozen'), held)).status).toBe('pass');
    });
  });

  describe('blackBars', () => {
    it('warns on a letterboxed cover clip and offers another take: the bars are in the footage', async () => {
      const pass = await measure('letterboxed');
      expect(pass.boxes[30]?.height).toBeLessThan(200);
      const result = blackBarsCheck(pass, qaPlan());
      expect(result.status).toBe('warn');
      expect(result.measured!.value).toBeLessThan(0.4);
      expect(result.findings[0]?.frames).toEqual({ start: 0, end: 60 });
      expect(result.fixes).toEqual([
        { kind: 'agent', instructionKey: 'qa.fixes.swapFromAlternates', params: { clipId: 'clip-a' } },
      ]);
    });

    it('leaves a clip the user set to contain alone', async () => {
      const plan = qaPlan({ clips: [{ id: 'clip-a', span: { start: 0, end: 60 }, fit: 'contain' }] });
      expect(blackBarsCheck(await measure('letterboxed'), plan).status).toBe('pass');
    });
  });
});
