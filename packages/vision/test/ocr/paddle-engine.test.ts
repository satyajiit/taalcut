// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok, type ComputeFallbackEvent } from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmbedderUnavailable, OcrFailed } from '../../src/errors';
import type { OnnxRuntime } from '../../src/onnx/ort';
import { createOrtRuntime } from '../../src/onnx/ort';
import { createPaddleDevanagariOcr } from '../../src/ocr/paddle/engine';
import { fakeSession, frame } from './helpers/fakes';
import { HAS_PADDLE, LINES, PADDLE_DIR, syntheticFrame } from './helpers/fixtures';

const CHARSET = Array.from({ length: 568 }, (_, i) => (i === 0 ? 'न' : i === 1 ? 'म' : `c${i}`));

/** A detector that sees one line in the middle, and a recogniser that reads "नम" for every crop. */
function fakeRuntime(opened: string[]): OnnxRuntime {
  return {
    async openSession(path) {
      opened.push(path);
      if (path.includes('det')) {
        return ok(
          fakeSession('det_out', (feeds) => {
            const [, , h = 0, w = 0] = feeds['x']?.dims ?? [];
            const data = new Float32Array(h * w);
            for (let y = Math.floor(h * 0.4); y < Math.floor(h * 0.5); y++)
              for (let x = Math.floor(w * 0.2); x < Math.floor(w * 0.8); x++) data[y * w + x] = 0.9;
            return { data, dims: [1, 1, h, w] };
          }),
        );
      }
      return ok(
        fakeSession('rec_out', (feeds) => {
          const n = feeds['x']?.dims[0] ?? 1;
          const steps = 3;
          const classes = 570;
          const data = new Float32Array(n * steps * classes);
          for (let i = 0; i < n; i++) {
            [1, 2, 0].forEach((c, t) => (data[(i * steps + t) * classes + c] = 1));
          }
          return { data, dims: [n, steps, classes] };
        }),
      );
    },
  };
}

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-paddle-'));
  await mkdir(join(dir, 'det'));
  await mkdir(join(dir, 'rec'));
  await writeFile(join(dir, 'charset.json'), JSON.stringify(CHARSET));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createPaddleDevanagariOcr (scripted sessions)', () => {
  it('detects, crops, recognises and normalises boxes', async () => {
    const opened: string[] = [];
    const engine = createPaddleDevanagariOcr({ onnx: fakeRuntime(opened), modelDir: dir });
    expect(await engine.capabilities()).toEqual({
      ok: true,
      value: { scripts: ['devanagari'], languages: ['hi'] },
    });
    const pages = await engine.recognize([frame(4, 100, 50, 30), frame(5, 100, 50, 30)], {
      languages: ['hi'],
    });
    expect(pages.ok).toBe(true);
    if (!pages.ok) return;
    expect(pages.value.map((p) => p.frame)).toEqual([4, 5]);
    const [o] = pages.value[0]?.observations ?? [];
    expect(o).toMatchObject({
      text: 'नम',
      script: 'devanagari',
      language: 'hi',
      engine: 'ppocr-v5',
      confidence: 1,
    });
    expect(o!.box.x).toBeGreaterThan(0.1);
    expect(o!.box.x + o!.box.width).toBeLessThanOrEqual(1);
    // Sessions open once, lazily.
    expect(opened.length).toBe(2);
    await engine.close?.();
  });

  it('refuses languages it does not read and empty input is free', async () => {
    const engine = createPaddleDevanagariOcr({ onnx: fakeRuntime([]), modelDir: dir });
    const latin = await engine.recognize([frame(0)], { languages: ['en'] });
    expect(!latin.ok && latin.error).toMatchObject({
      code: 'vision.ocr_unavailable',
      params: { language: 'en' },
    });
    expect(await engine.recognize([], { languages: [] })).toEqual({ ok: true, value: [] });
    const controller = new AbortController();
    controller.abort();
    const cancelled = await engine.recognize([frame(0)], { languages: ['hi'], signal: controller.signal });
    expect(!cancelled.ok && cancelled.error.code).toBe('core.cancelled');
  });

  it('reports a missing component or runtime as a missing model (UX3-IDX), and session failures as failures', async () => {
    const missing = createPaddleDevanagariOcr({ onnx: fakeRuntime([]), modelDir: join(dir, 'nope') });
    const m = await missing.recognize([frame(0)], { languages: ['hi'] });
    expect(!m.ok && m.error).toMatchObject({
      code: 'vision.model_missing',
      params: { component: 'ppocr-v5-devanagari' },
    });
    const noRuntime: OnnxRuntime = {
      openSession: async () =>
        err(EmbedderUnavailable(undefined, { detail: 'onnxruntime-node did not load' })),
    };
    const r = await createPaddleDevanagariOcr({ onnx: noRuntime, modelDir: dir }).recognize([frame(0)], {
      languages: ['hi'],
    });
    expect(!r.ok && r.error).toMatchObject({
      code: 'vision.model_missing',
      params: { component: 'onnxruntime' },
    });
    const failing: OnnxRuntime = {
      openSession: async () => err(OcrFailed(undefined, { detail: 'webgpu died' })),
    };
    const f = await createPaddleDevanagariOcr({ onnx: failing, modelDir: dir }).recognize([frame(0)], {
      languages: ['hi'],
    });
    expect(!f.ok && f.error.code).toBe('vision.ocr_failed');
    const noFile: OnnxRuntime = {
      openSession: async (path) =>
        path.includes('rec')
          ? err(OcrFailed(undefined, { detail: 'ENOENT: no such file' }))
          : fakeRuntime([]).openSession(path, { operation: 'x' }),
    };
    const n = await createPaddleDevanagariOcr({ onnx: noFile, modelDir: dir }).recognize([frame(0)], {
      languages: ['hi'],
    });
    expect(!n.ok && n.error).toMatchObject({
      code: 'vision.model_missing',
      params: { component: 'ppocr-v5-devanagari' },
    });
    const bad = await mkdtemp(join(tmpdir(), 'taalcut-paddle-bad-'));
    await writeFile(join(bad, 'charset.json'), JSON.stringify(['a', 'b']));
    const b = await createPaddleDevanagariOcr({ onnx: fakeRuntime([]), modelDir: bad }).recognize(
      [frame(0)],
      { languages: ['hi'] },
    );
    expect(!b.ok && b.error.code).toBe('vision.ocr_failed');
    await rm(bad, { recursive: true, force: true });
  });
});

describe.skipIf(!HAS_PADDLE)(
  `PP-OCRv5 Devanagari, live${HAS_PADDLE ? '' : ' (component not in .cache)'}`,
  () => {
    it('reads the Devanagari fixture lines on synthetic frames, on WebGPU', async () => {
      const fallbacks: ComputeFallbackEvent[] = [];
      const engine = createPaddleDevanagariOcr({
        onnx: createOrtRuntime({ onFallback: (event) => fallbacks.push(event) }),
        modelDir: PADDLE_DIR,
      });
      const lines = LINES.filter((l) => l.language === 'hi');
      const frames = lines.map((l, i) =>
        syntheticFrame(i, 720, 1280, [{ id: l.file.replace('.png', ''), left: 80, top: 300 + 120 * i }]),
      );
      // Warm-up: the first run compiles WebGPU kernels.
      await engine.recognize(frames.slice(0, 1), { languages: ['hi'] });
      const started = performance.now();
      const pages = await engine.recognize(frames, { languages: ['hi'] });
      const seconds = (performance.now() - started) / 1000;
      expect(pages.ok).toBe(true);
      if (!pages.ok) return;
      const read = pages.value.map((p) => p.observations.map((o) => o.text).join(' '));
      const exact = read.filter((text, i) => text === lines[i]?.text).length;
      console.warn(
        `PP-OCRv5 live: ${exact}/${lines.length} exact, ${(frames.length / seconds).toFixed(1)} frames/s at 720×1280, ` +
          `fallbacks: ${fallbacks.length} ${JSON.stringify(read)}`,
      );
      expect(fallbacks).toEqual([]);
      expect(exact).toBeGreaterThanOrEqual(lines.length - 1);
      for (const [i, page] of pages.value.entries()) {
        const o = page.observations[0];
        expect(o?.script).toBe('devanagari');
        // The painted line sits at x = 80 px, y = 300 + 120 i px.
        expect(o!.box.x).toBeCloseTo(80 / 720, 1);
        expect(o!.box.y).toBeCloseTo((300 + 120 * i) / 1280, 1);
      }
      await engine.close?.();
    }, 120_000);
  },
);
