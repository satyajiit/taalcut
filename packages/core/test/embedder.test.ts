// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The Embedder port over IPC (P2-L9, P2-L10): served by the jobs process, used by the agent. */
import { describe, expect, it } from 'vitest';
import {
  connectRpc,
  defineError,
  embedderOverRpc,
  embeddingsContract,
  embeddingsRouter,
  embeddingSpaceSchema,
  err,
  notServedRouter,
  ok,
  serveRpc,
  type Embedder,
  type EmbeddingSpace,
} from '@taalcut/core';
import { channel } from './helpers/ports';

const ModelMissing = defineError('test.embedder_model_missing', { retryable: true });

const space: EmbeddingSpace = {
  model: 'embeddinggemma-2',
  revision: 'onnx-q4-daa72c5',
  dimensions: 3,
  indexName: 'eg2_q4_daa72c5',
};

function fakeEmbedder(): Embedder & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    space,
    calls,
    async embedTexts(texts, { purpose }) {
      calls.push(purpose);
      if (texts.includes('fail')) return err(ModelMissing(undefined, { detail: 'no weights' }));
      return ok(texts.map((text) => Float32Array.from([text.length, 0, 1])));
    },
  };
}

function connect(embedder: Embedder) {
  const { port1, port2 } = channel();
  serveRpc(embeddingsRouter(embedder), port1, { context: {} });
  const client = connectRpc(embeddingsContract, port2, { peer: 'jobs' }).client;
  return { client, remote: embedderOverRpc(() => client, space) };
}

describe('embedder over IPC', () => {
  it('serves the space and unit vectors as Float32Arrays, in order', async () => {
    const embedder = fakeEmbedder();
    const { client, remote } = connect(embedder);
    expect(embeddingSpaceSchema.parse(await client.space())).toEqual(space);
    const vectors = await remote.embedTexts(['sunset', 'beach at night'], { purpose: 'query' });
    expect(vectors.ok && vectors.value.map((vector) => [...vector])).toEqual([
      [6, 0, 1],
      [14, 0, 1],
    ]);
    expect(vectors.ok && vectors.value[0]).toBeInstanceOf(Float32Array);
    expect(embedder.calls).toEqual(['query']);
  });

  it("returns the embedder's error as a value, without detail", async () => {
    const { remote } = connect(fakeEmbedder());
    const failed = await remote.embedTexts(['fail'], { purpose: 'document' });
    expect(failed).toMatchObject({
      ok: false,
      error: { code: 'test.embedder_model_missing', retryable: true },
    });
    expect(!failed.ok && failed.error.detail).toBeFalsy();
  });

  it('is cancelled before calling when the signal already fired', async () => {
    const { remote } = connect(fakeEmbedder());
    const controller = new AbortController();
    controller.abort();
    expect(await remote.embedTexts(['x'], { purpose: 'query', signal: controller.signal })).toMatchObject({
      ok: false,
      error: { code: 'core.cancelled' },
    });
  });

  it('refuses empty and oversized batches', async () => {
    const { client } = connect(fakeEmbedder());
    await expect(client.embedTexts({ texts: [], purpose: 'query' })).rejects.toMatchObject({
      data: { code: 'core.validation' },
    });
  });

  it('a namespace whose owner has not landed answers core.not_implemented', async () => {
    const { port1, port2 } = channel();
    serveRpc(notServedRouter(embeddingsContract, 'embeddings'), port1, { context: {} });
    const client = connectRpc(embeddingsContract, port2, { peer: 'jobs' }).client;
    await expect(client.space()).rejects.toMatchObject({
      data: { code: 'core.not_implemented', params: { feature: 'embeddings' } },
    });
    const remote = embedderOverRpc(() => client, space);
    expect(await remote.embedTexts(['x'], { purpose: 'query' })).toMatchObject({
      ok: false,
      error: { code: 'core.not_implemented' },
    });
  });
});
