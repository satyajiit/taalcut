// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Vision in the jobs process: its job kinds are registered, the embedder and
 * the vector index are on their core tokens, and `embeddings` is served for
 * the other processes. Nothing loads at start; without the EmbeddingGemma 2
 * component a search fails with vision.embedder_unavailable instead of
 * hanging, and the component is looked up again at the next call.
 */
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { connectRpc, EmbedderToken, EmbeddingIndexToken, serveRpc, UTILITY_CONTRACTS } from '@taalcut/core';
import { EMBEDDING_SPACE, visionJobKinds } from '@taalcut/vision';
import { composeJobs } from '../src/utility/roots/jobs-root';
import type { UtilityRoot } from '../src/utility/runtime';
import { testConfig } from './helpers/roots';

function serve(root: UtilityRoot): MessagePort {
  const { port1, port2 } = new MessageChannel();
  serveRpc(root.router, port1, { context: { caller: 'main' } });
  return port2;
}

describe('vision in the jobs root', () => {
  it('registers the kinds, the embedder and the index, and serves embeddings', async () => {
    const root = composeJobs(testConfig('jobs'), { pid: 1 });
    const { container } = root;
    const kinds = visionJobKinds.map((kind) => kind.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'vision.detectShots',
        'vision.analyzeShots',
        'vision.embedAsset',
        'vision.detectCuts',
      ]),
    );
    expect(container.resolve(EmbedderToken).space).toEqual(EMBEDDING_SPACE);
    // The jobs process's connection has no sqlite-vec yet (TODO(desktop) in roots/vision.ts).
    expect(container.has(EmbeddingIndexToken)).toBe(true);

    const client = connectRpc(UTILITY_CONTRACTS.jobs, serve(root), { peer: 'jobs' }).client;
    expect(await client.embeddings.space()).toEqual(EMBEDDING_SPACE);
    // No manifest in the test config, so the component isn't installed: a typed error, not a hang.
    await expect(
      client.embeddings.embedTexts({ texts: ['a beach at sunset'], purpose: 'query' }),
    ).rejects.toMatchObject({
      data: { code: 'vision.embedder_unavailable' },
    });
    await container.dispose();
  });
});
