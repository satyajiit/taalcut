// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok, type AsyncResult, type Result } from '@taalcut/core';
import {
  MediaCancelled,
  SidecarFailed,
  SidecarRejected,
  type JsonLineSidecar,
  type JsonValue,
} from '@taalcut/media';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppleVisionOcr } from '../../src/ocr/apple-vision';
import { frame } from './helpers/fakes';

interface Call {
  readonly method: string;
  readonly params: { paths?: string[]; languages?: string[] };
  readonly existed: boolean[];
}

function fakeSidecar(options: {
  ready?: Result<JsonValue>;
  reply?: (params: { paths: string[] }) => Result<JsonValue>;
  languages?: Result<JsonValue>;
}): JsonLineSidecar & { calls: Call[] } {
  const calls: Call[] = [];
  const ready =
    options.ready ?? ok({ type: 'ready', ocr: { languages: ['en-US', 'es-ES', 'pt-BR', 'fr-FR'] } });
  return {
    calls,
    async ready(): AsyncResult<JsonValue> {
      return ready;
    },
    async request(method, params, requestOptions): AsyncResult<JsonValue> {
      const p = params as { paths?: string[]; languages?: string[] };
      calls.push({ method, params: p, existed: (p.paths ?? []).map((path) => existsSync(path)) });
      if (requestOptions?.signal?.aborted) return err(MediaCancelled());
      if (method === 'ocr.languages') return options.languages ?? ok({ accurate: ['en'] });
      const paths = p.paths ?? [];
      if (options.reply) return options.reply({ paths });
      // Vision's space: the first box sits near the bottom of the frame (y measured from the bottom).
      const observations: JsonValue[] = [
        {
          text: '  Save  20%   today ',
          confidence: 0.98,
          language: 'en',
          box: { x: 0.1, y: 0.05, width: 0.5, height: 0.1 },
          // FIX-SIGN: the corners, top left first; the right side lower (a sign at an angle).
          quad: [
            { x: 0.1, y: 0.15 },
            { x: 0.6, y: 0.12 },
            { x: 0.6, y: 0.05 },
            { x: 0.1, y: 0.06 },
          ],
        },
        { text: '   ', confidence: 0.9, box: { x: 0, y: 0, width: 0.1, height: 0.1 } },
        {
          text: 'Edge',
          confidence: 1.4,
          language: 'not a tag!',
          box: { x: 0.95, y: 0.95, width: 0.2, height: 0.2 },
        },
      ];
      return ok({ boxSpace: 'normalized-lower-left', images: paths.map((path) => ({ path, observations })) });
    },
    async close() {},
  };
}

let temp: string;
beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), 'taalcut-ocr-'));
});
afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});

describe('createAppleVisionOcr', () => {
  it('converts lower-left boxes to top-left, normalises text, and cleans up its temp files', async () => {
    const sidecar = fakeSidecar({});
    const engine = createAppleVisionOcr(sidecar, { tempDir: temp });
    const pages = await engine.recognize([frame(12, 4, 4)], { languages: ['en', 'pt-BR', 'es'] });
    expect(pages.ok).toBe(true);
    if (!pages.ok) return;
    const [first, edge] = pages.value[0]?.observations ?? [];
    expect(pages.value[0]?.frame).toBe(12);
    expect(first).toMatchObject({
      text: 'Save 20% today',
      script: 'latin',
      language: 'en',
      engine: 'apple-vision',
    });
    expect(first?.box.x).toBeCloseTo(0.1);
    expect(first?.box.y).toBeCloseTo(0.85);
    expect(first?.box.height).toBeCloseTo(0.1);
    // Corners flipped to top-left like the box; an observation without them has none.
    expect(first?.quad?.map((point) => [point.x, Number(point.y.toFixed(2))])).toEqual([
      [0.1, 0.85],
      [0.6, 0.88],
      [0.6, 0.95],
      [0.1, 0.94],
    ]);
    expect(edge?.quad).toBeUndefined();
    // Clamped into the frame; confidence capped; a malformed language dropped.
    expect(edge?.box.x).toBeCloseTo(0.95);
    expect(edge?.box.width).toBeCloseTo(0.05);
    expect(edge?.box.y).toBe(0);
    expect(edge?.confidence).toBe(1);
    expect(edge && 'language' in edge).toBe(false);
    expect(pages.value[0]?.observations.length).toBe(2);
    const call = sidecar.calls[0];
    expect(call?.params.languages).toEqual(['en', 'pt', 'es']);
    expect(call?.existed).toEqual([true]);
    expect(await readdir(temp)).toEqual([]);
  });

  it('hands the helper BMP files by default (PNG when asked), and cleans them up', async () => {
    for (const [transfer, extension] of [
      [undefined, '.bmp'],
      ['bmp', '.bmp'],
      ['png', '.png'],
    ] as const) {
      const sidecar = fakeSidecar({});
      const engine = createAppleVisionOcr(sidecar, { tempDir: temp, ...(transfer ? { transfer } : {}) });
      const pages = await engine.recognize([frame(3, 4, 4), frame(4, 4, 4)], { languages: ['en'] });
      expect(pages.ok && pages.value.map((p) => p.frame)).toEqual([3, 4]);
      // Two frames are two one-frame requests, both in flight (requests.ts).
      const paths = sidecar.calls.flatMap((call) => call.params.paths ?? []);
      expect(paths.map((path) => path.endsWith(extension))).toEqual([true, true]);
      expect(sidecar.calls.flatMap((call) => call.existed)).toEqual([true, true]);
      expect(await readdir(temp)).toEqual([]);
    }
  });

  it('passes existing paths through and splits a call evenly over the requests in flight (IX3-O2)', async () => {
    const sidecar = fakeSidecar({});
    const engine = createAppleVisionOcr(sidecar, { tempDir: temp });
    const frames = Array.from({ length: 20 }, (_, i) =>
      i === 0 ? { ...frame(0), path: '/library/frame.png' } : frame(i),
    );
    const pages = await engine.recognize(frames, { languages: [] });
    expect(pages.ok && pages.value.map((p) => p.frame)).toEqual(frames.map((f) => f.index));
    // Two requests in flight: either may reach the helper first. 20 frames are 10 ‖ 10, not 16 then 4.
    const first = sidecar.calls.find((c) => c.params.paths?.[0] === '/library/frame.png');
    expect(sidecar.calls.map((c) => c.params.paths?.length)).toEqual([10, 10]);
    expect(first?.params.languages).toEqual([]);
    // A call smaller than one request still keeps both slots busy; one in flight keeps 16-frame requests.
    const small = fakeSidecar({});
    await createAppleVisionOcr(small, { tempDir: temp }).recognize(frames.slice(1, 14), {
      languages: ['en'],
    });
    expect(small.calls.map((c) => c.params.paths?.length).sort()).toEqual([6, 7]);
    const single = fakeSidecar({});
    await createAppleVisionOcr(single, { tempDir: temp, inFlight: 1 }).recognize(frames, {
      languages: ['en'],
    });
    expect(single.calls.map((c) => c.params.paths?.length)).toEqual([10, 10]);
    expect(await readdir(temp)).toEqual([]);
  });

  it("doesn't send Hindi to a Vision that doesn't list it (macOS 14 to 26)", async () => {
    const sidecar = fakeSidecar({});
    const engine = createAppleVisionOcr(sidecar, { tempDir: temp });
    const hindi = await engine.recognize([frame(0)], { languages: ['hi'] });
    expect(!hindi.ok && hindi.error).toMatchObject({
      code: 'vision.ocr_unavailable',
      params: { language: 'hi' },
    });
    await engine.recognize([frame(0)], { languages: ['hi', 'en'] });
    expect(sidecar.calls.at(-1)?.params.languages).toEqual(['en']);
  });

  it('maps helper errors', async () => {
    const reply = (code: string, retryable: boolean) => () =>
      err(
        retryable
          ? SidecarFailed({ helperCode: code })
          : SidecarRejected({ helperCode: code }, { detail: 'no' }),
      );
    const unsupported = createAppleVisionOcr(
      fakeSidecar({ reply: reply('ocr.language_unsupported', false) }),
      { tempDir: temp },
    );
    const u = await unsupported.recognize([frame(0)], { languages: ['fr'] });
    expect(!u.ok && u.error).toMatchObject({ code: 'vision.ocr_unavailable', params: { language: 'fr' } });
    const failed = createAppleVisionOcr(fakeSidecar({ reply: reply('ocr.failed', true) }), { tempDir: temp });
    const f = await failed.recognize([frame(0)], { languages: ['en'] });
    expect(!f.ok && f.error).toMatchObject({ code: 'vision.ocr_failed', retryable: true });
    expect(!f.ok && f.error.detail).toContain('ocr.failed');
    const cancelled = createAppleVisionOcr(fakeSidecar({ reply: () => err(MediaCancelled()) }), {
      tempDir: temp,
    });
    const c = await cancelled.recognize([frame(0)], { languages: ['en'] });
    expect(!c.ok && c.error.code).toBe('core.cancelled');
    const garbled = createAppleVisionOcr(fakeSidecar({ reply: () => ok({ images: [] }) }), { tempDir: temp });
    const g = await garbled.recognize([frame(0)], { languages: ['en'] });
    expect(!g.ok && g.error.code).toBe('vision.ocr_failed');
    expect(await readdir(temp)).toEqual([]);
  });

  it('honours cancellation before and during a request', async () => {
    const sidecar = fakeSidecar({});
    const engine = createAppleVisionOcr(sidecar, { tempDir: temp });
    const controller = new AbortController();
    controller.abort();
    const before = await engine.recognize([frame(0)], { languages: ['en'], signal: controller.signal });
    expect(!before.ok && before.error.code).toBe('core.cancelled');
    expect(sidecar.calls).toEqual([]);
    expect(await engine.recognize([], { languages: ['en'] })).toEqual({ ok: true, value: [] });
  });

  it('reads capabilities from the ready line, or asks the helper', async () => {
    const engine = createAppleVisionOcr(fakeSidecar({}), { tempDir: temp });
    expect(await engine.capabilities()).toEqual({
      ok: true,
      value: { scripts: ['latin'], languages: ['en-US', 'es-ES', 'pt-BR', 'fr-FR'] },
    });
    const asked = fakeSidecar({
      ready: ok({ type: 'ready' }),
      languages: ok({ accurate: ['en', 'hi', 'zh-Hans'], fast: [] }),
    });
    const caps = await createAppleVisionOcr(asked, { tempDir: temp }).capabilities();
    expect(caps.ok && caps.value.scripts).toEqual(['latin', 'devanagari', 'other']);
    expect(asked.calls.map((c) => c.method)).toEqual(['ocr.languages']);
  });

  it('reports a helper that will not start, and tries again next time', async () => {
    let attempts = 0;
    const sidecar = fakeSidecar({});
    const broken: JsonLineSidecar = {
      ...sidecar,
      async ready() {
        attempts++;
        return err(SidecarFailed(undefined, { detail: 'crashed at start' }));
      },
    };
    const engine = createAppleVisionOcr(broken, { tempDir: temp });
    const caps = await engine.capabilities();
    expect(!caps.ok && caps.error.code).toBe('vision.ocr_failed');
    const pages = await engine.recognize([frame(0)], { languages: ['en'] });
    expect(!pages.ok && pages.error.code).toBe('vision.ocr_failed');
    expect(attempts).toBe(2);
    const badList = fakeSidecar({ ready: ok({}), languages: ok({ nope: true }) });
    const listed = await createAppleVisionOcr(badList, { tempDir: temp }).capabilities();
    expect(!listed.ok && listed.error.code).toBe('vision.ocr_failed');
    const listFails = fakeSidecar({ ready: ok({}), languages: err(SidecarFailed()) });
    const lf = await createAppleVisionOcr(listFails, { tempDir: temp }).capabilities();
    expect(!lf.ok && lf.error.code).toBe('vision.ocr_failed');
  });
});
