// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Text embeddings in the library's embedding space (P2-L9). Library search
 * (P2-L10) and casting (P2-M2) embed query text in the same space as the
 * stored vectors and may not import vision, which implements the model in the
 * jobs process. Other processes get it over IPC: `embeddingsRouter` in the
 * jobs process, forwarded by main to the agent (MAIN_SERVICE_CONTRACTS.agent),
 * where `embedderOverRpc` makes it an Embedder again. A search must not wait
 * behind the GPU job queue, so this is a direct call, not a job: the embedder
 * serves queries between its batches.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { CancelledError } from '../basics/errors';
import { err, ok, type AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import { implementContract, ipc, type RpcClient } from '../ipc/contract';
import { fromRpcError, unwrapRpc } from '../ipc/errors';

export const EMBEDDING_ITEM_KINDS = ['frame', 'transcript', 'ocr', 'description'] as const;
export type EmbeddingItemKind = (typeof EMBEDDING_ITEM_KINDS)[number];

/** Which vectors are comparable: same model, revision and width. */
export interface EmbeddingSpace {
  /** 'embeddinggemma-2'. */
  readonly model: string;
  /** Weights and dtype, e.g. 'onnx-q4-daa72c5'. */
  readonly revision: string;
  readonly dimensions: number;
  /** VectorIndex name for this space, e.g. 'eg2_q4_daa72c5'. */
  readonly indexName: string;
}

export const embeddingSpaceSchema: z.ZodType<EmbeddingSpace> = z.object({
  model: z.string().min(1).max(64),
  revision: z.string().min(1).max(64),
  dimensions: z.int().positive().max(4096),
  indexName: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
});

/** 'query': search boxes and slot intents. 'document': text stored in the index. */
export const EMBEDDING_PURPOSES = ['query', 'document'] as const;
export type EmbeddingPurpose = (typeof EMBEDDING_PURPOSES)[number];

export interface Embedder {
  readonly space: EmbeddingSpace;
  /** Unit vectors, one per text, in order. The embedder adds the model's prefix for the purpose. */
  embedTexts(
    texts: readonly string[],
    options: { readonly purpose: EmbeddingPurpose; readonly signal?: AbortSignal },
  ): AsyncResult<Float32Array[]>;
}

export const EmbedderToken = createToken<Embedder>('core.embedder');

export const embeddingsContract = {
  space: ipc.output(embeddingSpaceSchema),
  embedTexts: ipc
    .input(
      z.object({
        texts: z.array(z.string().min(1).max(8192)).min(1).max(64),
        purpose: z.enum(EMBEDDING_PURPOSES),
      }),
    )
    .output(z.object({ vectors: z.array(z.array(z.number())).max(64) })),
};

/** Serves an Embedder (the jobs process). Vectors cross IPC as number arrays. */
export function embeddingsRouter(embedder: Embedder) {
  const os = implementContract(embeddingsContract);
  return os.router({
    space: os.space.handler(() => embedder.space),
    embedTexts: os.embedTexts.handler(async ({ input, signal }) => {
      const result = await embedder.embedTexts(input.texts, {
        purpose: input.purpose,
        ...(signal ? { signal } : {}),
      });
      return { vectors: unwrapRpc(result).map((vector) => Array.from(vector)) };
    }),
  });
}

/**
 * An Embedder in another process (the agent, main). `space` is read once with `client().space()` when
 * the process connects; `client` is a function so a restarted jobs process is picked up.
 */
export function embedderOverRpc(
  client: () => RpcClient<typeof embeddingsContract>,
  space: EmbeddingSpace,
): Embedder {
  return {
    space,
    async embedTexts(texts, { purpose, signal }) {
      if (signal?.aborted) return err(CancelledError());
      try {
        const { vectors } = await client().embedTexts(
          { texts: [...texts], purpose },
          signal ? { signal } : {},
        );
        return ok(vectors.map((vector) => Float32Array.from(vector)));
      } catch (cause) {
        return err(fromRpcError(cause));
      }
    },
  };
}
