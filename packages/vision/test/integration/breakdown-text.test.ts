// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * vision.readOverlays on the golden set's synthetic reels: the committed
 * text-line PNGs are composited by FFmpeg onto each reel at the label's
 * overlay box and frames (end exclusive, like the label's slots), then read
 * back through the routed OCR (Apple Vision by the mac helper, PP-OCRv5 for
 * Devanagari) and tracked to frame edges. Synthetic numbers. Skips without
 * FFmpeg or the helper; the Hindi reel also needs the PP-OCR component.
 */
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDirectJobRunner } from '@taalcut/core';
import { createJsonLineSidecar, createSidecarResolver, type JsonLineSidecar } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { breakdownJobRegistrations } from '../../src/jobs/breakdown-handlers';
import { visionReadOverlaysJob } from '../../src/jobs/breakdown-kinds';
import { createAppleVisionOcr } from '../../src/ocr/apple-vision';
import { createPaddleDevanagariOcr } from '../../src/ocr/paddle/engine';
import { createRoutedOcr } from '../../src/ocr/router';
import type { OcrEngine } from '../../src/ocr/types';
import { createOrtRuntime } from '../../src/onnx/ort';
import { goldenLabel, makeGoldenReel } from '../breakdown/golden-reel';
import { testMedia } from '../helpers/reel';
import {
  OCR_READY_TIMEOUT_MS,
  OCR_SETUP_TIMEOUT_MS,
  prepareOcrFixture,
} from '../ocr/helpers/fixture-startup';
import { FIXTURE_DIR, HAS_PADDLE, PADDLE_DIR, line } from '../ocr/helpers/fixtures';

const { ctx } = await testMedia('breakdown-text');
const helper = await createSidecarResolver({
  name: 'taalcut-mac-helper',
  development: true,
  pin: '',
  env: process.env,
}).resolve();
if (!helper.ok) console.warn(`breakdown-text: skipped, no mac helper (${helper.error.code})`);

const WIDTH = 720;
const HEIGHT = 1280;
/** Which fixture line stands in for each label's overlay, and the language to read it in. */
const CASES = [
  { id: 'sample-en-30', fixture: 'latin-en', languages: ['en'] },
  { id: 'sample-es-25', fixture: 'latin-es', languages: ['es'] },
  { id: 'sample-hi-2997', fixture: 'deva-namaste', languages: ['hi'] },
] as const;

const normalise = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim();

describe.skipIf(!ctx || !helper.ok)('on-screen text on synthetic reels', () => {
  let temp = '';
  let sidecar: JsonLineSidecar;
  let router: OcrEngine;
  const errors: { start: number; end: number }[] = [];

  beforeAll(async () => {
    // The helper resolves symlinks (/var → /private/var) before checking its allowed roots.
    temp = await realpath(await mkdtemp(join(tmpdir(), 'taalcut-breakdown-text-')));
    sidecar = createJsonLineSidecar({
      command: helper.ok ? helper.value.path : '',
      args: ['serve', '--services', 'ocr,image', '--allow-root', temp],
      readyTimeoutMs: OCR_READY_TIMEOUT_MS,
    });
    const vision = createAppleVisionOcr(sidecar, { tempDir: temp });
    await prepareOcrFixture(sidecar, vision);
    router = createRoutedOcr({
      vision,
      ...(HAS_PADDLE
        ? { devanagari: createPaddleDevanagariOcr({ onnx: createOrtRuntime(), modelDir: PADDLE_DIR }) }
        : {}),
    });
  }, OCR_SETUP_TIMEOUT_MS);
  afterAll(async () => {
    await router?.close?.();
    await sidecar?.close();
    if (temp) await rm(temp, { recursive: true, force: true });
  });

  for (const testCase of CASES) {
    const devanagari = testCase.languages[0] === 'hi';
    it.skipIf(devanagari && !HAS_PADDLE)(
      `reads the overlay of ${testCase.id} with its box and frames`,
      async () => {
        const label = goldenLabel(testCase.id);
        const overlay = label.overlays[0]!;
        const { meta } = line(testCase.fixture);
        const x = Math.round(overlay.position.x * WIDTH);
        const y = Math.round(overlay.position.y * HEIGHT);
        const path = join(temp, `${testCase.id}.mp4`);
        await makeGoldenReel(ctx!, path, label, {
          width: WIDTH,
          height: HEIGHT,
          extraInputs: [`${FIXTURE_DIR}${meta.file}`],
          finish: `[v][x0]overlay=x=${x}:y=${y}:enable='between(n,${overlay.startFrame},${overlay.endFrame - 1})'[out]`,
        });
        const jobs = createDirectJobRunner(
          breakdownJobRegistrations({ media: ctx!, tier: 'recommended', tempDir: temp, ocr: router }),
        );
        const started = Date.now();
        const result = await jobs.run(visionReadOverlaysJob, {
          path,
          fps: 4,
          languages: [...testCase.languages],
          cutFrames: [...label.cuts],
        });
        const ms = Date.now() - started;
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail ?? ''}`);
        const found = result.value.overlays.find((o) => normalise(o.text) === normalise(meta.text));
        const start = found?.range.start.value ?? -1;
        const end = found ? start + found.range.duration.value : -1;
        console.warn(
          `[vision] text ${testCase.id} (synthetic, ${ms} ms): read ${JSON.stringify(result.value.overlays.map((o) => [o.text, o.range.start.value, o.range.start.value + o.range.duration.value, o.reveal]))}; ` +
            `labelled "${meta.text}" ${overlay.startFrame}–${overlay.endFrame} at (${x}, ${y})`,
        );
        expect(
          found,
          `"${meta.text}" in ${JSON.stringify(result.value.overlays.map((o) => o.text))}`,
        ).toBeDefined();
        if (!found) return;
        errors.push({ start: Math.abs(start - overlay.startFrame), end: Math.abs(end - overlay.endFrame) });
        // The eval's ±2 frames. Usually 0; one full parallel run read 8 for a start labelled 6 (re-encoded
        // reels aren't bit-identical, and a missed frame in the bisection costs up to 2).
        expect(Math.abs(start - overlay.startFrame)).toBeLessThanOrEqual(2);
        expect(Math.abs(end - overlay.endFrame)).toBeLessThanOrEqual(2);
        expect(found.box.x).toBeCloseTo(overlay.position.x, 1);
        expect(found.box.y).toBeGreaterThanOrEqual(overlay.position.y - 0.02);
        expect(found.box.y).toBeLessThan(overlay.position.y + (meta.height + 10) / HEIGHT);
        expect(found.script).toBe(devanagari ? 'devanagari' : 'latin');
        expect(found.confidence).toBeGreaterThan(0.3);
        // One track, not split at the cuts inside it. (testsrc2 and friends draw their own timecodes; those are read too.)
        expect(result.value.overlays.filter((o) => normalise(o.text) === normalise(meta.text))).toHaveLength(
          1,
        );
      },
      300_000,
    );
  }

  it('reports the frame error of the tracked edges', () => {
    if (errors.length === 0) return;
    const worst = (key: 'start' | 'end') => Math.max(...errors.map((e) => e[key]));
    console.warn(
      `[vision] on-screen text edges (synthetic, ${errors.length} reels): worst start error ${worst('start')} frames, ` +
        `worst end error ${worst('end')} frames`,
    );
  });
});
