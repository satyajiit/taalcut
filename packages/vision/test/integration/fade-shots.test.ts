// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-D2 live: synthetic reels (FFmpeg lavfi, the software encoder) through the analysis pass and TransNetV2, as
 * `vision.shots` runs them, at 30 and 60 fps (60 is streamed at 30). A fade out, half a second of black and a fade
 * in is one boundary of kind `fade` inside its black frames; a cut to black and back stays two cuts; a low-key shot
 * drifting in and out of black has no boundary inside it; every hard cut is where it was. Runs when the transnetv2
 * component folder is present (as transnet-shots.test.ts).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unwrap, type AsyncResult, type ComputeFallbackEvent } from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shotModelDevices } from '../../src/cuts/backends';
import { TRANSNET_FILE, transNetLoader, type ShotBoundaryModel } from '../../src/cuts/transnet';
import { createOrtRuntime } from '../../src/onnx/ort';
import { detectShots } from '../../src/shots/detect-shots';
import { componentDir } from '../helpers/offline';
import { makeReel, testMedia, type Segment } from '../helpers/reel';

const { ctx } = await testMedia('fade shots');
const modelDir = componentDir('transnetv2', TRANSNET_FILE);

/** Low-key, as fades-v1's night shots: the level scaled toward video black by a factor drifting 0.05–0.15. */
const DARK = '(0.10+0.05*sin(2*PI*T/4))';
const darken = `geq=lum='16+(lum(X\\,Y)-16)*${DARK}':cb='128+(cb(X\\,Y)-128)*${DARK}*3':cr='128+(cr(X\\,Y)-128)*${DARK}*3'`;

/** Two seconds a shot (at `fps`): a cut, a fade through black, a cut, a cut to black and back, a cut to a dark shot. */
function reel(fps: number) {
  const s = (seconds: number) => Math.round(seconds * fps);
  const segments: Segment[] = [
    { source: 'testsrc2', frames: s(2) },
    { source: 'smptebars', frames: s(2), filter: `fade=t=out:start_frame=${s(1.5)}:nb_frames=${s(0.5)}` },
    { source: 'color=c=black', frames: s(0.5) },
    { source: 'testsrc2', frames: s(2), filter: `hue=h=200,fade=t=in:start_frame=0:nb_frames=${s(0.5)}` },
    { source: 'cellauto', frames: s(2) },
    { source: 'color=c=black', frames: s(1) },
    { source: 'testsrc2', frames: s(2), filter: 'hue=h=120' },
    { source: 'mandelbrot=end_scale=0.05', frames: s(3), filter: darken },
  ];
  return {
    segments,
    cuts: [s(2), s(6.5), s(8.5), s(9.5), s(11.5)],
    fade: { from: s(3.5), to: s(5), black: { from: s(4), to: s(4.5) - 1 } },
  };
}

describe.skipIf(!ctx || !modelDir)('fades through black with the live model', () => {
  let dir: string;
  let boundaryModel: (signal?: AbortSignal) => AsyncResult<ShotBoundaryModel>;
  const fallbacks: ComputeFallbackEvent[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-fades-'));
    const onnx = createOrtRuntime({
      onFallback: (event) => fallbacks.push(event),
      devices: shotModelDevices(process.platform),
    });
    boundaryModel = transNetLoader(onnx, async () => modelDir!);
  });
  afterAll(async () => {
    const model = await boundaryModel?.();
    if (model?.ok) await model.value.release();
    await rm(dir, { recursive: true, force: true });
  });

  for (const fps of [30, 60]) {
    it(`marks the fade once and keeps the cuts at ${fps} fps`, async () => {
      const { segments, cuts, fade } = reel(fps);
      const path = join(dir, `fades-${fps}.mp4`);
      await makeReel(ctx!, path, segments, { width: 320, height: 180, rate: String(fps) });
      const found = unwrap(await detectShots(path, { media: ctx!, boundaryModel }));
      console.warn(
        `[vision] fades ${fps}: ${found.cuts.map((c) => `${c.frame}${c.kind?.[0] ?? ''}${c.span ? `[${c.span.from}-${c.span.to}]` : ''}`).join(' ')}; labelled cuts ${cuts.join(' ')}, fade ${fade.from}–${fade.to}`,
      );
      expect(fallbacks).toEqual([]);
      expect(found.detector).toBe('model');
      const fades = found.cuts.filter((cut) => cut.kind === 'fade');
      expect(fades).toHaveLength(1);
      const [marked] = fades;
      expect(marked!.frame).toBeGreaterThanOrEqual(fade.black.from);
      expect(marked!.frame).toBeLessThanOrEqual(fade.black.to + 1);
      // The span's ends are walked over the 10-a-second samples: on moving footage the mean may keep rising a
      // sample or two past the fade's end, so they are known to two samples.
      const reach = 2 * Math.round(fps / 10);
      expect(marked!.span!.from).toBeGreaterThanOrEqual(fade.from - reach);
      expect(marked!.span!.to).toBeLessThanOrEqual(fade.to + reach);
      // Nothing else between the cuts around the fade, and every hard cut (the black's two included) to the frame.
      const hard = found.cuts.filter((cut) => cut.kind !== 'fade');
      expect(hard.map((cut) => cut.kind)).toEqual(cuts.map(() => 'cut'));
      hard.forEach((cut, i) => expect(Math.abs(cut.frame - cuts[i]!)).toBeLessThanOrEqual(1));
    }, 180_000);
  }
});
