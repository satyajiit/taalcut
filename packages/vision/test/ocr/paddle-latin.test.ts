// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * PP-OCRv5 Latin (IX-O7) on its recorded output: the real model's detector bitmap and recogniser steps on the
 * committed Latin lines (scripts/ppocr-record.ts, CPU EP on a Mac), replayed through the engine. Not run on
 * Windows hardware; the opt-in `paddle-latin.int.test.ts` runs the model itself when it is installed.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOcrMeter } from '../../src/ocr/meter';
import { createPaddleOcr } from '../../src/ocr/paddle/engine';
import { PADDLE_LATIN } from '../../src/ocr/paddle/models';
import { LINES } from './helpers/fixtures';
import { latinRecording, recordedCharset, replayRuntime } from './helpers/latin-recording';
import { latinScene } from './helpers/latin-scene';

const recording = latinRecording();
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-paddle-latin-'));
  await mkdir(join(dir, 'det'));
  await mkdir(join(dir, 'rec'));
  await writeFile(join(dir, 'charset.json'), JSON.stringify(recordedCharset(recording)));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('PP-OCRv5 Latin, recorded', () => {
  it('reads what the model read, where it read it', async () => {
    const meter = createOcrMeter();
    const engine = createPaddleOcr({ onnx: replayRuntime(recording), modelDir: dir, model: PADDLE_LATIN });
    const pages = await engine.recognize([latinScene()], { languages: ['en', 'es', 'pt'], meter });
    expect(pages.ok).toBe(true);
    if (!pages.ok) return;
    const read = pages.value[0]?.observations ?? [];
    expect(read.map((o) => o.text)).toEqual(recording.read.map((o) => o.text));
    read.forEach((o, i) => {
      const want = recording.read[i];
      expect(o.box.x).toBeCloseTo(want?.box.x ?? -1, 6);
      expect(o.box.y).toBeCloseTo(want?.box.y ?? -1, 6);
      expect(o.box.width).toBeCloseTo(want?.box.width ?? -1, 6);
      expect(o.confidence).toBeCloseTo(want?.confidence ?? -1, 3);
      expect(o).toMatchObject({ script: 'latin', engine: 'ppocr-v5' });
      expect(o.language).toBeUndefined();
    });
    expect(meter.counts()).toMatchObject({ requests: 1, frames: 1, devanagariRequests: 0 });
  });

  it('read the three committed lines', () => {
    const lines = LINES.filter((line) => line.language !== 'hi').map((line) => line.text);
    expect(recording.read.map((o) => o.text)).toEqual(lines);
  });

  it('serves Latin languages only', async () => {
    const engine = createPaddleOcr({ onnx: replayRuntime(recording), modelDir: dir, model: PADDLE_LATIN });
    expect(await engine.capabilities()).toEqual({
      ok: true,
      value: { scripts: ['latin'], languages: PADDLE_LATIN.languages },
    });
    const hindi = await engine.recognize([latinScene()], { languages: ['hi'] });
    expect(!hindi.ok && hindi.error.code).toBe('vision.ocr_unavailable');
  });

  it('refuses a charset of the wrong size', async () => {
    const bad = await mkdtemp(join(tmpdir(), 'taalcut-paddle-latin-bad-'));
    await writeFile(join(bad, 'charset.json'), JSON.stringify(['a', 'b']));
    const engine = createPaddleOcr({ onnx: replayRuntime(recording), modelDir: bad, model: PADDLE_LATIN });
    const result = await engine.recognize([latinScene()], { languages: ['en'] });
    expect(!result.ok && result.error.detail).toBe('charset.json is not 836 characters');
    await rm(bad, { recursive: true, force: true });
  });
});
