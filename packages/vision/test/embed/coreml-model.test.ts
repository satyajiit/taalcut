// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Core ML model's side of the helper's embed service (IX2-E5), against a fake helper: the load, how frames and
 * texts travel (rgb24 files in the allowed folder, token ids), requests in flight, vectors decoded in order, and
 * helper failures as thrown errors. The real helper and model are in coreml-parity.int.test.ts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { SidecarFailed, type JsonLineSidecar, type JsonValue } from '@taalcut/media';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { embedServeArgs, loadCoreMlModel } from '../../src/embed/coreml-model';
import type { EmbeddingImage, Tokenizer } from '../../src/embed/model';
import { embeddingFrameSize } from '../../src/embed/space';

const imagesParams = z.object({
  tokens: z.number(),
  frames: z.array(z.object({ path: z.string(), width: z.number(), height: z.number() })),
});
const textsParams = z.object({ ids: z.array(z.array(z.number())) });

/** A vector whose first values say what the helper saw. */
function encoded(...values: number[]): string {
  const vector = new Float32Array(768);
  vector.set(values);
  return Buffer.from(vector.buffer).toString('base64');
}

interface Seen {
  readonly method: string;
  readonly params: JsonValue;
}

function fakeHelper(failOn?: string) {
  const seen: Seen[] = [];
  const state = { inFlight: 0, maxInFlight: 0, closed: 0 };
  // A frame request waits (up to a second) for a second one to join it, so two sent at once overlap however slowly
  // their files are written on a loaded machine; one sent alone still answers.
  const joined: (() => void)[] = [];
  const overlap = () =>
    new Promise<void>((resolve) => {
      if (state.inFlight >= 2) {
        for (const wake of joined.splice(0)) wake();
        resolve();
        return;
      }
      joined.push(resolve);
      setTimeout(resolve, 1000);
    });
  const answer = (method: string, params: JsonValue): JsonValue => {
    if (method === 'embed.prepare') return { loadMs: 1 };
    if (method === 'embed.images') {
      const { tokens, frames } = imagesParams.parse(params);
      // Each frame's file: its length and first byte, read while the request is in flight.
      const vectors = frames.map((f) => {
        const bytes = readFileSync(f.path);
        return encoded(bytes.length, bytes[0] ?? -1, tokens, f.width);
      });
      return { vectors };
    }
    const { ids } = textsParams.parse(params);
    return { vectors: ids.map((list) => encoded(list.length, list[1] ?? -1)) };
  };
  const sidecar: JsonLineSidecar = {
    ready: async () => ok({}),
    async request(method, params): AsyncResult<JsonValue> {
      seen.push({ method, params });
      state.inFlight++;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      await (method === 'embed.images' ? overlap() : new Promise((resolve) => setTimeout(resolve, 5)));
      state.inFlight--;
      if (method === failOn) {
        return err(SidecarFailed({ helperCode: 'embed.failed' }, { detail: 'the model gave no embedding' }));
      }
      return ok(answer(method, params));
    },
    async close() {
      state.closed++;
    },
  };
  return { sidecar, seen, state };
}

/** Token ids: `<bos>`, one id per character, `<eos>`. */
const tokenizer: Tokenizer = (texts) => ({
  input_ids: {
    data: BigInt64Array.from([2n, ...[...(texts[0] ?? '')].map((c) => BigInt(c.charCodeAt(0))), 1n]),
  },
});

function frame(tokens: 70 | 140 | 280, value: number): EmbeddingImage {
  const { width, height } = embeddingFrameSize(1920, 1080, tokens);
  return { width, height, rgb: new Uint8Array(width * height * 3).fill(value) };
}

describe('the Core ML model over the helper', () => {
  let temp: string;
  beforeEach(async () => {
    temp = await realpath(await mkdtemp(join(tmpdir(), 'taalcut-coreml-model-')));
  });
  afterEach(async () => {
    await rm(temp, { recursive: true, force: true });
  });

  it('starts the embed service over the component and the allowed folder', () => {
    expect(embedServeArgs('/c/eg2-coreml', ['/t'])).toEqual([
      'serve',
      '--services',
      'embed',
      '--models',
      '/c/eg2-coreml',
      '--allow-root',
      '/t',
    ]);
  });

  it('loads every budget first, the index budget on rewarm, and closes the helper when the models will not load', async () => {
    const good = fakeHelper();
    const model = await loadCoreMlModel({
      open: () => good.sidecar,
      tempDir: temp,
      tokenizerDir: '/x',
      tokenizer,
    });
    expect(model.device).toBe('coreml');
    expect(good.seen).toEqual([{ method: 'embed.prepare', params: { budgets: [70, 140, 280] } }]);
    // An import start brings back a helper that exited idle: the text model and the index budget's frames (IX3-N4).
    await model.rewarm?.(140);
    expect(good.seen).toEqual([
      { method: 'embed.prepare', params: { budgets: [70, 140, 280] } },
      { method: 'embed.prepare', params: { budgets: [140] } },
    ]);
    await model.dispose();
    expect(good.state.closed).toBe(1);

    const bad = fakeHelper('embed.prepare');
    await expect(
      loadCoreMlModel({ open: () => bad.sidecar, tempDir: temp, tokenizerDir: '/x', tokenizer }),
    ).rejects.toThrow(/embed\.prepare: embed\.failed/);
    expect(bad.state.closed).toBe(1);
  });

  it('sends frames as rgb24 files in the allowed folder, two requests at once, and removes them', async () => {
    const helper = fakeHelper();
    const model = await loadCoreMlModel({
      open: () => helper.sidecar,
      tempDir: temp,
      tokenizerDir: '/x',
      tokenizer,
    });
    const frames = [1, 2, 3, 4, 5].map((value) => frame(140, value));
    const vectors = await model.embedImages(frames);
    const calls = helper.seen
      .filter((s) => s.method === 'embed.images')
      .map((s) => imagesParams.parse(s.params));
    // Each request writes its files before it is sent, so either may reach the helper first.
    expect(calls.map((c) => c.frames.length).sort()).toEqual([2, 3]);
    expect(helper.state.maxInFlight).toBe(2);
    for (const call of calls) {
      expect(call.tokens).toBe(140);
      for (const f of call.frames) expect(f.path.startsWith(`${temp}/`)).toBe(true);
    }
    const first = frames[0];
    expect(vectors.map((v) => v[1])).toEqual([1, 2, 3, 4, 5]);
    expect(vectors[0]?.[0]).toBe(first ? first.width * first.height * 3 : 0);
    expect(vectors[0]?.[3]).toBe(first?.width);
    expect(calls.flatMap((c) => c.frames).some((f) => existsSync(f.path))).toBe(false);
    expect(await readdir(temp)).toEqual([]);
  });

  it('sends texts as token ids, sixteen to a request, in order', async () => {
    const helper = fakeHelper();
    const model = await loadCoreMlModel({
      open: () => helper.sidecar,
      tempDir: temp,
      tokenizerDir: '/x',
      tokenizer,
    });
    const texts = Array.from({ length: 20 }, (_, i) => String.fromCharCode(65 + i).repeat(i + 1));
    const vectors = await model.embedTexts(texts);
    const calls = helper.seen
      .filter((s) => s.method === 'embed.texts')
      .map((s) => textsParams.parse(s.params));
    expect(calls.map((c) => c.ids.length)).toEqual([16, 4]);
    expect(calls[0]?.ids[0]).toEqual([2, 65, 1]);
    expect(vectors.map((v) => v[0])).toEqual(texts.map((t) => t.length + 2));
    expect(vectors.map((v) => v[1])).toEqual(texts.map((t) => t.charCodeAt(0)));
  });

  it('throws a helper failure with its code, still removing the frame files', async () => {
    const helper = fakeHelper('embed.images');
    const model = await loadCoreMlModel({
      open: () => helper.sidecar,
      tempDir: temp,
      tokenizerDir: '/x',
      tokenizer,
    });
    await expect(model.embedImages([frame(70, 9)])).rejects.toThrow(/embed\.images: embed\.failed/);
    expect(await readdir(temp)).toEqual([]);
    await expect(model.embedImages([frame(70, 9), frame(280, 9)])).rejects.toThrow(/one image-token budget/);
  });
});
