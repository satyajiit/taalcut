// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The OCR fixture set end to end: Latin and Devanagari text-line PNGs painted
 * onto synthetic frames, read back through the router by the real mac helper
 * (Apple Vision) and PP-OCRv5 on WebGPU, with boxes and confidence, then
 * tracked to frame-exact edges. Skips without the helper
 * (native/mac-helper/build.sh) or the PP-OCR component in .cache.
 */
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FrameRate } from '@taalcut/core';
import { createJsonLineSidecar, createSidecarResolver, type JsonLineSidecar } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrtRuntime } from '../../src/onnx/ort';
import { createAppleVisionOcr } from '../../src/ocr/apple-vision';
import { createPaddleDevanagariOcr } from '../../src/ocr/paddle/engine';
import { recognizeWithReuse } from '../../src/ocr/reuse';
import { createRoutedOcr } from '../../src/ocr/router';
import { trackOnScreenText } from '../../src/ocr/track';
import type { OcrEngine } from '../../src/ocr/types';
import { HAS_PADDLE, LINES, PADDLE_DIR, syntheticFrame } from '../ocr/helpers/fixtures';
import {
  OCR_READY_TIMEOUT_MS,
  OCR_SETUP_TIMEOUT_MS,
  prepareOcrFixture,
} from '../ocr/helpers/fixture-startup';

const helper = await createSidecarResolver({
  name: 'taalcut-mac-helper',
  development: true,
  pin: '',
  env: process.env,
}).resolve();
if (!helper.ok)
  console.warn(
    `ocr integration: skipped, no mac helper (${helper.error.code}); run native/mac-helper/build.sh`,
  );

describe.skipIf(!helper.ok)('OCR fixture set through the router (mac helper)', () => {
  let temp: string;
  let sidecar: JsonLineSidecar;
  let router: OcrEngine;

  beforeAll(async () => {
    // The helper resolves symlinks (/var → /private/var) before checking its allowed roots.
    temp = await realpath(await mkdtemp(join(tmpdir(), 'taalcut-ocr-it-')));
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

  it('reads the Latin lines exactly, with top-left boxes where they were painted', async () => {
    const latin = LINES.filter((l) => l.language !== 'hi');
    const frames = latin.map((l, i) =>
      syntheticFrame(i, 720, 1280, [{ id: l.file.replace('.png', ''), left: 120, top: 900 }]),
    );
    const started = performance.now();
    const pages = await router.recognize(frames, { languages: ['en', 'es', 'pt-BR'] });
    const ms = performance.now() - started;
    expect(pages.ok).toBe(true);
    if (!pages.ok) return;
    const read = pages.value.map((p) => p.observations.map((o) => o.text).join(' '));
    const exact = read.filter((text, i) => text === latin[i]?.text).length;
    console.warn(
      `Apple Vision live: ${exact}/${latin.length} exact, ${(ms / frames.length).toFixed(0)} ms/frame ${JSON.stringify(read)}`,
    );
    expect(exact).toBe(latin.length);
    for (const page of pages.value) {
      const o = page.observations[0]!;
      expect(o.engine).toBe('apple-vision');
      expect(o.confidence).toBeGreaterThan(0.3);
      // Painted at y = 900 of 1280 (lower part): a lower-left box left unconverted would sit near the top.
      expect(o.box.y).toBeGreaterThan(0.65);
      expect(o.box.y).toBeLessThan(0.78);
      expect(o.box.x).toBeCloseTo(120 / 720, 1);
    }
  }, 120_000);

  it.skipIf(!HAS_PADDLE)(
    'reads a Hinglish frame: the Latin line from Vision, the Hindi line from PP-OCR',
    async () => {
      const frame = syntheticFrame(0, 720, 1280, [
        { id: 'latin-en', left: 120, top: 300 },
        { id: 'deva-namaste', left: 120, top: 700 },
      ]);
      const pages = await router.recognize([frame], { languages: ['en', 'hi'] });
      expect(pages.ok).toBe(true);
      if (!pages.ok) return;
      const observations = pages.value[0]!.observations;
      expect(observations.map((o) => [o.text, o.engine, o.script])).toEqual([
        ['Save 20% today', 'apple-vision', 'latin'],
        ['नमस्ते दोस्तों', 'ppocr-v5', 'devanagari'],
      ]);
    },
    120_000,
  );

  it('tracks a caption to frame-exact edges with reuse and bisection', async () => {
    // Visible on frames [10, 30) of a 48-frame, 30 fps clip; samples every 8 frames (≈ 4 fps).
    const render = (index: number) =>
      syntheticFrame(
        index,
        640,
        360,
        index >= 10 && index < 30 ? [{ id: 'latin-pt', left: 60, top: 200 }] : [],
      );
    const samples = [0, 8, 16, 24, 32, 40].map(render);
    const pages = await recognizeWithReuse(router, samples, { languages: ['pt-BR'] });
    expect(pages.ok).toBe(true);
    if (!pages.ok) return;
    const tracked = await trackOnScreenText({
      rate: FrameRate.of(30),
      pages: pages.value,
      endFrame: 48,
      ocrFrames: async (indexes, signal) =>
        router.recognize(indexes.map(render), { languages: ['pt-BR'], ...(signal ? { signal } : {}) }),
    });
    expect(tracked.ok).toBe(true);
    if (!tracked.ok) return;
    expect(tracked.value.map((t) => [t.text, t.range.start.value, t.range.duration.value, t.reveal])).toEqual(
      [['Não perca essa oferta', 10, 20, 'none']],
    );
  }, 120_000);
});
