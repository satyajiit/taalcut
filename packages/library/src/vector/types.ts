// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The vector index port (PRD 6.4, "Vector index"): sqlite-vec today, swappable
 * (e.g. LanceDB for very large libraries) without touching callers. The port
 * lives in @taalcut/core (vision writes vectors and may not import library);
 * this package implements it and re-exports the types for its own callers.
 */
export type {
  VectorFilter,
  VectorIndex,
  VectorItem,
  VectorMatch,
  VectorMetadata,
  VectorMetric,
  VectorSearchOptions,
} from '@taalcut/core';
