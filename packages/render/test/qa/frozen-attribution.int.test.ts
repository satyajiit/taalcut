// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Who made a freeze (docs/qa-gate.md, frozenFrames): the clip's segment is asked over the render freeze's own
 * frames, seen as the render frames it and anchored at the freeze's first frame (qa/passes/source-stillness.ts).
 * Fixtures made with the bundled FFmpeg, measured by the real video pass:
 *
 * - a rigid block the crop follows across a plain backdrop: the framed picture is still, so the render's freeze is
 *   the footage's (a warning, no re-render), although the segment itself moves (the whole segment says render);
 * - a panning crop over moving footage, framed with a duplicated frame injected for a second: the render made that
 *   freeze, and it is still failed with a re-render;
 * - a still subject in a blurred-pad clip, contained in a landscape canvas: the footage's.
 *
 * The render freeze in the first case starts after an intended-static range, so the segment is read from frame 20
 * on, not from its start.
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MediaContext } from '@taalcut/media';
import { frozenFramesCheck } from '../../src/qa/checks/video';
import type { ReframedClip } from '../../src/qa/checks/reframe';
import { runVideoPass, type VideoPass } from '../../src/qa/measure/video-pass';
import { segmentView, sourceStillness, viewFilters } from '../../src/qa/passes/source-stillness';
import type { CropKey } from '../../src/reframe/framing-types';
import { ffmpeg, findTestMedia, mediaContext, tempDir } from '../support/media';
import { PASS_VIDEO, qaPlan, rate30 } from './support';

const media = await findTestMedia('qa frozen attribution');

const FRAMES = 60;
const PORTRAIT = { width: 1080, height: 1920 };
const BACKDROP = '0x202830';
const BLOCK = '0xd04030';

/**
 * The tracked clip: an upright source 1200×540 whose segment is the extent x 0.1–0.9 (960×540). The block (160×280)
 * moves 4 px a frame; the 9:16 window (304 px wide) keeps it centred.
 */
const SOURCE = { width: 1200, height: 540 };
const EXTENT = { x: 0.1, y: 0, width: 0.8, height: 1 };
const blockX = (n: number) => 200 + 4 * n;
const windowKey = (n: number): CropKey => ({
  frame: n,
  rect: { x: (120 + blockX(n) + 80 - 152) / SOURCE.width, y: 0, width: 304 / SOURCE.width, height: 1 },
});

const cropClip = (keys: readonly CropKey[]): ReframedClip => ({
  clipId: 'clip-a',
  visible: { start: 0, end: FRAMES },
  framing: { kind: 'crop', reason: 'subject', keys, subject: [], scale: 1, faces: [], raw: [] },
  reframe: null,
  source: SOURCE,
  extent: EXTENT,
});

describe.skipIf(!media.binaries)('frozenFrames attribution', () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  const file = (name: string) => join(work.dir, `${name}.mp4`);
  const encode = (name: string, graph: string) =>
    ffmpeg(ctx, ['-filter_complex', graph, ...PASS_VIDEO, '-an', file(name)]);
  const measure = async (name: string): Promise<VideoPass> => {
    const result = await runVideoPass(ctx, file(name), { rate: rate30 });
    if (!result.ok) throw new Error(`${result.error.code} ${result.error.detail ?? ''}`);
    return result.value;
  };
  /** The clip's segment, from render frame 0, as `clip` frames it on `canvas`. */
  const stillness = (
    segment: string,
    clip: ReframedClip | undefined,
    canvas: { readonly width: number; readonly height: number } = PORTRAIT,
  ) =>
    sourceStillness(
      ctx,
      new Map([['clip-a', { path: file(segment), startFrame: 0 }]]),
      () => segmentView(clip, canvas),
      { rate: rate30 },
    );

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('qa-frozen-attribution');
    const plain = (size: string) => `color=c=${BACKDROP}:s=${size}:r=30:d=2`;
    const block = (size: string) => `color=c=${BLOCK}:s=${size}:r=30:d=2`;
    // The segment: the block crossing the plain backdrop.
    await encode(
      'tracked',
      `${plain('960x540')}[bg];${block('160x280')}[b];[bg][b]overlay=x='200+4*n':y=130:eval=frame`,
    );
    // What the render shows of it: the block standing still in the middle of the frame.
    await encode(
      'trackedRender',
      `${plain('540x960')}[bg];${block('284x498')}[b];[bg][b]overlay=x=128:y=231`,
    );
    // Moving footage, and the render of it through a panning crop with frame 20 held over frames 21–49.
    await encode('panning', 'testsrc2=s=960x540:r=30:d=2');
    const pan = viewFilters(segmentView(cropClip([windowKey(0), windowKey(59)]), PORTRAIT), 0, FRAMES);
    await ffmpeg(ctx, [
      ...['-i', file('panning'), '-filter_complex'],
      `[0:v]${pan.join(',')},scale=540:960,split[a][b];[a][b]freezeframes=first=21:last=49:replace=20`,
      ...[...PASS_VIDEO, '-an', file('panningFrozen')],
    ]);
    // A portrait subject, still, padded into a landscape canvas: the segment and its render.
    await encode('portrait', `${plain('304x540')}[bg];${block('120x200')}[b];[bg][b]overlay=x=92:y=170`);
  });
  afterAll(() => work?.dispose());

  it('credits the footage with a still its crop makes: a block followed across a plain backdrop', async () => {
    const pass = await measure('trackedRender');
    expect(pass.freezes).toEqual([{ start: 0, end: FRAMES }]);
    const plan = qaPlan({ durationFrames: FRAMES, intendedStatic: [{ start: 0, end: 20 }] });
    const keys = [windowKey(0), windowKey(30), windowKey(59)];
    // Framed, the footage holds its frame-20 picture to the end; whole, the moving block leaves it within frames.
    const span = { start: 20, end: FRAMES };
    expect(await stillness('tracked', cropClip(keys))('clip-a', span)).toBe(40);
    expect(await stillness('tracked', undefined)('clip-a', span)).toBeLessThan(20);
    // A still asked about part of it holds for exactly that part: the range reads no frame past its end.
    expect(await stillness('trackedRender', undefined)('clip-a', { start: 10, end: 30 })).toBe(20);
    const framed = await frozenFramesCheck(pass, plan, stillness('tracked', cropClip(keys)));
    expect(framed.status).toBe('warn');
    expect(framed.findings).toEqual([
      { frames: { start: 20, end: FRAMES }, target: { kind: 'clip', id: 'clip-a' } },
    ]);
    expect(framed.fixes).toEqual([
      { kind: 'agent', instructionKey: 'qa.fixes.swapOrTrimStatic', params: { clipId: 'clip-a' } },
    ]);
    // The segment itself moves: seen whole, as before the crop was taken into account, the render is blamed.
    const whole = await frozenFramesCheck(pass, plan, stillness('tracked', undefined));
    expect(whole.status).toBe('fail');
    expect(whole.fixes).toEqual([{ kind: 'auto', action: 'rerender' }]);
  });

  it('fails a freeze the render made: a duplicated frame in moving footage through a panning crop', async () => {
    const pass = await measure('panningFrozen');
    expect(pass.freezes).toHaveLength(1);
    expect(pass.freezes[0]!.start).toBeGreaterThanOrEqual(19);
    expect(pass.freezes[0]!.start).toBeLessThanOrEqual(20);
    expect(pass.freezes[0]!.end).toBe(50);
    const panning = stillness('panning', cropClip([windowKey(0), windowKey(59)]));
    // The footage, through the same crop, leaves the freeze's first picture on the next frame.
    expect(await panning('clip-a', pass.freezes[0]!)).toBe(1);
    const result = await frozenFramesCheck(pass, qaPlan({ durationFrames: FRAMES }), panning);
    expect(result.status).toBe('fail');
    expect(result.fixes).toEqual([{ kind: 'auto', action: 'rerender' }]);
  });

  it("credits the footage with a blurred-pad clip's still subject", async () => {
    const pass = await measure('portrait');
    expect(pass.freezes).toEqual([{ start: 0, end: FRAMES }]);
    const padded: ReframedClip = {
      clipId: 'clip-a',
      visible: { start: 0, end: FRAMES },
      framing: { kind: 'blurPad', reason: 'subjectTooTall' },
      reframe: null,
      source: { width: 304, height: 540 },
      extent: { x: 0, y: 0, width: 1, height: 1 },
    };
    const result = await frozenFramesCheck(
      pass,
      qaPlan({ durationFrames: FRAMES }),
      stillness('portrait', padded, { width: 1920, height: 1080 }),
    );
    expect(result.status).toBe('warn');
  });

  it('blames the render when the footage could not be read', async () => {
    const result = await frozenFramesCheck(
      await measure('trackedRender'),
      qaPlan({ durationFrames: FRAMES }),
      sourceStillness(
        ctx,
        new Map([['clip-a', { path: file('missing'), startFrame: 0 }]]),
        () => ({ kind: 'whole' }),
        {
          rate: rate30,
          decode: 'software',
        },
      ),
    );
    expect(result.status).toBe('fail');
  });
});
