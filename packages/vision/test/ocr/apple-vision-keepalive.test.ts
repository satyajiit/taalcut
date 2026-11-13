// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** FIX-OCRCOLD: how long the client waits for the helper, its warm-up, and Hindi where macOS lists it. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok, type AsyncResult, type Result } from '@taalcut/core';
import {
  SidecarFailed,
  type JsonLineRequestOptions,
  type JsonLineSidecar,
  type JsonValue,
} from '@taalcut/media';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppleVisionOcr } from '../../src/ocr/apple-vision';
import { describeWarmUp } from '../../src/ocr/apple-vision-wire';
import { createRoutedOcr } from '../../src/ocr/router';
import { fakeEngine, frame } from './helpers/fakes';

interface Sent {
  readonly method: string;
  readonly params: { languages?: string[] };
  readonly options: JsonLineRequestOptions | undefined;
}

/** macOS 27.2's list, as the helper's ready line gives it (abridged). */
const MACOS_27 = ['en', 'fr', 'de', 'es', 'pt', 'zh', 'ko', 'ja', 'ru', 'th', 'ar-SA', 'fi', 'hi', 'mr'];

function helper(
  ready: JsonValue,
  warm: Result<JsonValue> = ok({ steps: [], ms: 0, yieldedMs: 0 }),
): JsonLineSidecar & { sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    async ready(): AsyncResult<JsonValue> {
      return ok(ready);
    },
    async request(method, params, options): AsyncResult<JsonValue> {
      sent.push({ method, params: params as Sent['params'], options });
      if (method === 'ocr.warmup') return warm;
      const paths = (params as { paths: string[] }).paths;
      return ok({ images: paths.map(() => ({ ms: 300, observations: [] })) });
    },
    async close() {},
  };
}

const v2 = (languages = ['en', 'es', 'pt']) => ({
  type: 'ready',
  protocol: 2,
  serviceVersions: { ocr: 2, image: 1, text: 1 },
  ocr: { languages },
});

let temp: string;
beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), 'taalcut-ocr-'));
});
afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});

describe('Apple Vision client, FIX-OCRCOLD', () => {
  it('waits on a helper that keeps alive: up to 10 minutes a request, giving up after 30 s of silence', async () => {
    const alive = helper(v2());
    await createAppleVisionOcr(alive, { tempDir: temp }).recognize([frame(0)], { languages: ['en'] });
    expect(alive.sent[0]?.options).toMatchObject({ timeoutMs: 600_000, stallTimeoutMs: 30_000 });
    const tuned = helper(v2());
    await createAppleVisionOcr(tuned, { tempDir: temp, timeoutMs: 5_000, stallMs: 1_000 }).recognize(
      [frame(0)],
      { languages: ['en'] },
    );
    expect(tuned.sent[0]?.options).toMatchObject({ timeoutMs: 5_000, stallTimeoutMs: 1_000 });
  });

  it('keeps the fixed 60 s for a helper without a keepalive', async () => {
    const readies: JsonValue[] = [
      { type: 'ready', protocol: 2, serviceVersions: { ocr: 1 }, ocr: { languages: ['en'] } },
      { type: 'ready', protocol: 1, ocr: { languages: ['en'] } },
    ];
    for (const ready of readies) {
      const old = helper(ready);
      const engine = createAppleVisionOcr(old, { tempDir: temp });
      await engine.recognize([frame(0)], { languages: ['en'] });
      expect(old.sent[0]?.options?.timeoutMs).toBe(60_000);
      expect(old.sent[0]?.options?.stallTimeoutMs).toBeUndefined();
      // Nothing to warm: no request is sent.
      expect(await engine.warm?.()).toEqual({ ok: true, value: null });
      expect(old.sent.map((s) => s.method)).toEqual(['ocr.recognize']);
    }
  });

  it("waits for the helper's warm-up and reports each step", async () => {
    const steps: JsonValue[] = [
      { script: 'latin', languages: ['en'], ms: 81_897, lines: 1 },
      { script: 'devanagari', languages: ['hi'], ms: 53_216, lines: 1 },
      { script: 'arabic', languages: ['ar'], ms: 29_304, error: 'ocr.failed' },
    ];
    const cache = 'taalcut-mac-helper-0123456789abcdef';
    const warm = helper(v2(MACOS_27), ok({ steps, ms: 164_500, yieldedMs: 2_000, cache }));
    const report = await createAppleVisionOcr(warm, { tempDir: temp }).warm?.();
    expect(report).toEqual({
      ok: true,
      value: {
        steps: [
          { script: 'latin', ms: 81_897 },
          { script: 'devanagari', ms: 53_216 },
          { script: 'arabic', ms: 29_304, error: 'ocr.failed' },
        ],
        ms: 164_500,
        yieldedMs: 2_000,
        cache,
      },
    });
    expect(warm.sent[0]).toMatchObject({ method: 'ocr.warmup', options: { stallTimeoutMs: 30_000 } });
    expect(report?.ok && describeWarmUp(report.value!)).toBe(
      'OCR warm-up in 164.5 s (latin 81.9 s, devanagari 53.2 s, arabic ocr.failed; waited 2.0 s for reads)',
    );
    const failing = helper(v2(), err(SidecarFailed()));
    const failed = await createAppleVisionOcr(failing, { tempDir: temp }).warm?.();
    expect(!failed?.ok && failed?.error.code).toBe('vision.ocr_failed');
    const odd = helper(v2(), ok({ nope: true }));
    const unexpected = await createAppleVisionOcr(odd, { tempDir: temp }).warm?.();
    expect(!unexpected?.ok && unexpected?.error.detail).toBe('ocr.warmup: unexpected reply');
    // A cache name that isn't a build's folder is not taken as one.
    const strange = helper(v2(), ok({ steps: [], ms: 0, cache: '../Taalcut' }));
    const refused = await createAppleVisionOcr(strange, { tempDir: temp }).warm?.();
    expect(!refused?.ok && refused?.error.detail).toBe('ocr.warmup: unexpected reply');
  });

  it('sends Hindi to Vision where this macOS lists it, and reads it as Devanagari', async () => {
    const listed = helper(v2(MACOS_27));
    const engine = createAppleVisionOcr(listed, { tempDir: temp });
    const caps = await engine.capabilities();
    expect(caps.ok && caps.value.scripts).toEqual(['latin', 'other', 'devanagari']);
    const pages = await engine.recognize([frame(0)], { languages: ['en', 'hi', 'es', 'pt-BR'] });
    expect(pages.ok).toBe(true);
    expect(listed.sent[0]?.params.languages).toEqual(['en', 'hi', 'es', 'pt']);
    // The router then sends Hindi to Vision alone: the PP-OCR Devanagari engine is never asked.
    const devanagari = fakeEngine({ scripts: ['devanagari'], languages: ['hi'] }, () => []);
    await createRoutedOcr({ vision: engine, devanagari }).recognize([frame(1)], { languages: ['en', 'hi'] });
    expect(devanagari.calls).toEqual([]);
    expect(listed.sent.at(-1)?.params.languages).toEqual(['en', 'hi']);
  });
});
