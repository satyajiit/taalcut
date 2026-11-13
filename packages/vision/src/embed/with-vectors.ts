// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, ok, type Result } from '@taalcut/core';
import { EmbeddingFailed } from '../errors';

/** Each item with its vector, in order: `vision.embedding_failed` when the counts differ. */
export function withVectors<T>(
  items: readonly T[],
  vectors: readonly Float32Array[],
): Result<{ item: T; vector: Float32Array }[]> {
  const paired = items.flatMap((item, i) => {
    const vector = vectors[i];
    return vector ? [{ item, vector }] : [];
  });
  if (paired.length !== items.length || vectors.length !== items.length)
    return err(
      EmbeddingFailed(undefined, { detail: `${items.length} inputs gave ${vectors.length} vectors` }),
    );
  return ok(paired);
}
