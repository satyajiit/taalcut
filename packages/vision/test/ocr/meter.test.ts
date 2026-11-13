// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FrameRate, ok, type AsyncResult, type NormalisedBox } from '@taalcut/core';
import type { JsonLineSidecar, JsonValue } from '@taalcut/media';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppleVisionOcr } from '../../src/ocr/apple-vision';
import { addOcrCounts, createOcrMeter, ocrCountsSchema } from '../../src/ocr/meter';
import { recognizeWithReuse } from '../../src/ocr/reuse';
import { createRoutedOcr } from '../../src/ocr/router';
import { trackOnScreenText } from '../../src/ocr/track';
import { DEVA_CAPS, LATIN_CAPS, fakeEngine, frame, observation } from './helpers/fakes';

const BOX: NormalisedBox = { x: 0.1, y: 0.8, width: 0.6, height: 0.06 };

/** A helper that answers every image with one observation and a Vision time of 40 ms. */
function timedSidecar(): JsonLineSidecar & { params: JsonValue[] } {
  const params: JsonValue[] = [];
  return {
    params,
    async ready(): AsyncResult<JsonValue> {
      return ok({ type: 'ready', ocr: { languages: ['en-US', 'es-ES', 'pt-BR'] } });
    },
    async request(_method, body): AsyncResult<JsonValue> {
      params.push(body);
      const paths = (body as { paths: string[] }).paths;
      return ok({
        images: paths.map((path) => ({
          path,
          ms: 40,
          observations: [{ text: 'SALE', confidence: 0.9, box: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 } }],
        })),
      });
    },
    async close() {},
  };
}

let temp: string;
beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), 'taalcut-ocr-meter-'));
});
afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});

describe('OCR meter', () => {
  it('starts at zero and adds two jobs', () => {
    const meter = createOcrMeter();
    expect(ocrCountsSchema.parse(meter.counts())).toMatchObject({
      requests: 0,
      frames: 0,
      ms: { engine: 0 },
    });
    meter.request({
      engine: 'ppocr-v5',
      frames: 3,
      languages: 1,
      encodeMs: 0,
      requestMs: 12.4,
      engineMs: 12.4,
      parseMs: 0,
    });
    meter.decoded('refine', 7.6);
    meter.tracked(true);
    meter.refined(4);
    const one = meter.counts();
    expect(one).toMatchObject({
      requests: 1,
      frames: 3,
      devanagariRequests: 1,
      devanagariFrames: 3,
      refineCalls: 4,
      refineDecodes: 1,
      tracks: 1,
      flickers: 1,
      ms: { request: 12, decode: 8 },
    });
    const two = addOcrCounts(one, one);
    expect(two).toMatchObject({ requests: 2, refineCalls: 8, maxLanguages: 1, ms: { request: 24 } });
  });

  it('records each helper request: frames, languages, Vision time, and the settings it sent', async () => {
    const sidecar = timedSidecar();
    const engine = createAppleVisionOcr(sidecar, {
      tempDir: temp,
      recognition: {
        level: 'fast',
        languageCorrection: false,
        autoDetectLanguage: false,
        minimumTextHeight: 0.05,
      },
    });
    const meter = createOcrMeter();
    const frames = Array.from({ length: 20 }, (_, i) => frame(i));
    const pages = await engine.recognize(frames, { languages: ['en', 'es'], meter });
    expect(pages.ok && pages.value).toHaveLength(20);
    const counts = meter.counts();
    expect(counts).toMatchObject({ requests: 2, frames: 20, languages: 4, maxLanguages: 2 });
    expect(counts.ms.engine).toBe(20 * 40);
    expect(counts.ms.request).toBeGreaterThanOrEqual(0);
    expect(sidecar.params[0]).toMatchObject({
      level: 'fast',
      languageCorrection: false,
      autoDetectLanguage: false,
      minimumTextHeight: 0.05,
    });
  });

  it('counts reused frames and passes the meter through the router to both engines', async () => {
    const vision = fakeEngine(LATIN_CAPS, () => []);
    const deva = fakeEngine(DEVA_CAPS, () => []);
    const seen: unknown[] = [];
    const spy = (engine: typeof vision) => ({
      ...engine,
      recognize: (...args: Parameters<typeof engine.recognize>) => {
        seen.push(args[1].meter);
        return engine.recognize(...args);
      },
    });
    const router = createRoutedOcr({ vision: spy(vision), devanagari: spy(deva) });
    const meter = createOcrMeter();
    // Three identical frames then a different one: two of the four reuse a page.
    const frames = [frame(0, 8, 8, 10), frame(30, 8, 8, 10), frame(60, 8, 8, 10), frame(90, 8, 8, 200)];
    const read = await recognizeWithReuse(router, frames, { languages: ['en', 'hi'], meter });
    expect(read.ok).toBe(true);
    expect(meter.counts()).toMatchObject({ sampled: 4, reused: 2 });
    expect(seen).toEqual([meter, meter]);
  });

  it('counts tracks, flickers and the refinement reads', async () => {
    const meter = createOcrMeter();
    const reads: number[] = [];
    const result = await trackOnScreenText(
      {
        rate: FrameRate.of(30),
        pages: [
          { frame: 0, observations: [] },
          { frame: 8, observations: [observation('Ghost', BOX)] },
          { frame: 16, observations: [] },
        ],
        ocrFrames: async (frames) => {
          reads.push(...frames);
          return ok(frames.map((f) => ({ frame: f, observations: [] })));
        },
      },
      { meter },
    );
    expect(result.ok && result.value).toEqual([]);
    expect(meter.counts()).toMatchObject({ tracks: 1, flickers: 1, refineCalls: reads.length });
    expect(reads.length).toBeGreaterThan(0);
  });
});
