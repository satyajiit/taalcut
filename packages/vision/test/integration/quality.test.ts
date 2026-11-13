// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * analyzeShots on synthetic clips (FFmpeg lavfi): sharpness falls with gblur,
 * stability falls with a jittered crop, a steady crop move reads as a pan,
 * exposure flags dark, clipped and black clips; on-screen text goes through
 * the OCR engine at a sample a second plus the best frame. Casting's curves
 * have a sample per 100 ms, and a sudden move is a motion peak to the frame.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FrameRate, ok, RationalTime, type ShotAnalysis, type ShotSignals } from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeShots, orientationOf } from '../../src/analysis/analyze-shots';
import { MOTION_CONFIG } from '../../src/motion/config';
import { withFrameSource } from '../../src/media/media-frame-source';
import { readShotText } from '../../src/ocr/shot-text';
import type { OcrEngine, OcrFrame } from '../../src/ocr/types';
import { makeReel, testMedia } from '../helpers/reel';

const { ctx } = await testMedia('quality');

/** testsrc2 animates; a still of its first frame held for the clip is a steady, textured shot. */
const STILL = "select='eq(n\\,0)',loop=loop=59:size=1,setpts=N/30/TB";
const CLIPS = {
  sharp: STILL,
  blurred: `${STILL},gblur=sigma=5`,
  shaky: `${STILL},scale=iw*1.3:ih*1.3,crop=480:270:x='40+30*sin(n*2.3)':y='30+25*cos(n*1.9)'`,
  pan: `${STILL},scale=iw*2:ih*2,crop=480:270:x='n*6':y=100`,
  dark: `${STILL},lutyuv=y=val*0.1`,
  clipped: `${STILL},lutyuv=y=val*3`,
  // Still, then the frame jumps 70 px right at frame 45 and stays.
  jolt: `${STILL},scale=iw*1.4:ih*1.4,crop=480:270:x='if(gte(n\\,45)\\,90\\,20)':y=20`,
} as const;

const RATE = FrameRate.of(30);
const whole = { start: RationalTime.of(0, RATE), duration: RationalTime.of(60, RATE) };

describe.skipIf(!ctx)('analyzeShots on synthetic clips', () => {
  let dir: string;
  const results = new Map<string, ShotAnalysis>();
  const profiles = new Map<string, ShotSignals>();

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-quality-'));
    const all = { ...CLIPS, black: STILL };
    for (const [name, filter] of Object.entries(all)) {
      const path = join(dir, `${name}.mp4`);
      const source = name === 'black' ? 'color=c=black' : 'testsrc2';
      await makeReel(ctx!, path, [{ source, frames: 60, filter }], { width: 480, height: 270, rate: '30' });
      const fallbacks: unknown[] = [];
      const analysed = await analyzeShots(
        { path, shots: [{ shotId: name, range: whole }] },
        { media: ctx!, onFallback: (e) => fallbacks.push(e) },
      );
      if (!analysed.ok) throw new Error(`${name}: ${analysed.error.code} ${analysed.error.detail ?? ''}`);
      expect(fallbacks).toHaveLength(1);
      results.set(name, analysed.value[0]!.analysis);
      profiles.set(name, analysed.value[0]!.analysis.signals!);
    }
    console.warn(
      `[vision] quality on synthetic clips: ${[...results].map(([n, a]) => `${n} sharp ${a.quality.sharpness.toFixed(2)} exp ${a.quality.exposure.toFixed(2)} stab ${a.quality.stability.toFixed(2)} ${a.motion} [${a.quality.flags.join(',')}]`).join('; ')}`,
    );
  }, 180_000);
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('gives every shot a valid profile', () => {
    for (const analysis of results.values()) {
      expect(analysis.version).toBe(1);
      expect(analysis.dHash).toMatch(/^[0-9a-f]{16}$/);
      expect(analysis.orientation).toBe('landscape');
      expect(analysis.bestFrame).toBeGreaterThanOrEqual(0);
      expect(analysis.bestFrame).toBeLessThan(60);
      expect(analysis.descriptionSkipped).toBe('not_yet');
    }
  });

  it('scores blur, shake, a pan and exposure problems', () => {
    const sharp = results.get('sharp')!;
    const blurred = results.get('blurred')!;
    expect(blurred.quality.sharpness).toBeLessThan(sharp.quality.sharpness);
    expect(blurred.quality.flags).toContain('blurry');
    expect(sharp.quality.flags).not.toContain('blurry');
    expect(results.get('shaky')!.quality.stability).toBeLessThan(sharp.quality.stability);
    expect(results.get('shaky')!.quality.flags).toContain('shaky');
    expect(results.get('pan')!.motion).toBe('pan');
    // FRM1-MOT: the move is measured as a reel's slot is, and kept with the estimator's version.
    expect(results.get('pan')!.motionMeasure).toMatchObject({ label: 'pan', version: MOTION_CONFIG.version });
    expect(results.get('sharp')!.motion).toBe('static');
    expect(results.get('shaky')!.motion).toBe('handheld');
    // Nothing to track on a black frame: no measure, the analysis's own class.
    expect(results.get('black')!.motionMeasure).toBeUndefined();
    expect(results.get('dark')!.quality.flags).toContain('dark');
    expect(results.get('clipped')!.quality.flags).toContain('overexposed');
    expect(results.get('black')!.quality.flags).toContain('black');
    expect(sharp.quality.overall).toBeGreaterThan(blurred.quality.overall);
  });

  it('reads on-screen text at a sample a second on the asset’s grid, sample-grain (vision.ocr)', async () => {
    const seen: number[] = [];
    const engine: OcrEngine = {
      capabilities: async () => ok({ scripts: ['latin'], languages: ['en', 'es', 'pt-BR'] }),
      recognize: async (frames: readonly OcrFrame[]) => {
        seen.push(...frames.map((f) => f.index));
        return ok(
          frames.map((f) => ({
            frame: f.index,
            observations:
              f.index >= 15
                ? [
                    {
                      text: 'SALE 50%',
                      box: { x: 0.1, y: 0.8, width: 0.5, height: 0.1 },
                      confidence: 0.9,
                      script: 'latin' as const,
                      engine: 'fake',
                    },
                  ]
                : [],
          })),
        );
      },
    };
    // The panning clip: every sample differs, so none reuses an earlier OCR result.
    const read = await withFrameSource(undefined, ctx!, join(dir, 'pan.mp4'), undefined, (frames) =>
      readShotText([{ shotId: 's', range: whole }], frames, engine, ['en', 'hi']),
    );
    expect(read.ok).toBe(true);
    const text = read.ok ? (read.value[0]?.onScreenText ?? []) : [];
    expect(text).toHaveLength(1);
    expect(text[0]).toMatchObject({ text: 'SALE 50%', script: 'latin', reveal: 'none' });
    // Shown from frame 15 to the end (60): the samples are the grid's frames 0 and 30 (no extra best frame when
    // the grid falls in the shot), and nothing else is read, so the text is stored on frame 30 alone.
    expect(seen).toEqual([0, 30]);
    expect([text[0]?.range.start.value, text[0]?.range.duration.value]).toEqual([30, 1]);
  });

  it('gives casting 100 ms curves and the frame a sudden move peaks on', () => {
    for (const profile of profiles.values()) {
      expect(profile.motionCurve).toHaveLength(20);
      expect(profile.sharpnessCurve).toHaveLength(20);
    }
    expect(profiles.get('jolt')!.motionPeakFrames).toEqual([45]);
    expect(profiles.get('sharp')!.motionPeakFrames).toEqual([]);
    const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean(profiles.get('blurred')!.sharpnessCurve)).toBeLessThan(
      mean(profiles.get('sharp')!.sharpnessCurve),
    );
    expect(mean(profiles.get('pan')!.motionCurve)).toBeGreaterThan(
      mean(profiles.get('sharp')!.motionCurve) + 0.2,
    );
  });

  it('knows portrait, landscape and square', () => {
    expect(orientationOf(1080, 1920)).toBe('portrait');
    expect(orientationOf(1920, 1080)).toBe('landscape');
    expect(orientationOf(1000, 1010)).toBe('square');
  });
});
