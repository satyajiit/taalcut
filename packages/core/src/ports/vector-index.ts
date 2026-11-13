// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The vector index port (PRD 6.4, "Vector index"), moved here from
 * @taalcut/library unchanged: vision writes vectors, library implements the
 * index (sqlite-vec today, swappable) and searches it, and vision may not
 * import library. The composition root opens the index of the active
 * embedding space (`Embedder.space.indexName`) and registers it as
 * EmbeddingIndexToken.
 */
import type { Result } from '../basics/result';
import { createToken } from '../di/token';

export const VECTOR_METRICS = ['cosine', 'l2'] as const;
export type VectorMetric = (typeof VECTOR_METRICS)[number];

/** What a vector can be filtered by. Missing values are stored as empty and read back as null. */
export interface VectorMetadata {
  readonly assetId?: string | null;
  readonly sourceId?: string | null;
  /** In the library's index: 'frame', 'transcript', 'ocr', 'description' (EMBEDDING_ITEM_KINDS). Other indexes name their own. */
  readonly kind?: string | null;
}

export interface VectorItem {
  /** Caller's id, e.g. 'frame:<shotId>:0'. Upserting the same id replaces the vector. */
  readonly id: string;
  readonly vector: Float32Array | readonly number[];
  readonly metadata?: VectorMetadata;
}

/** Each field matches one value or any of a list. Fields combine with AND. */
export interface VectorFilter {
  readonly assetId?: string | readonly string[];
  readonly sourceId?: string | readonly string[];
  readonly kind?: string | readonly string[];
}

export interface VectorMatch {
  readonly id: string;
  /** Cosine distance (1 − cosine similarity, 0..2) or L2 distance, by the index's metric. Smallest first. */
  readonly distance: number;
  readonly metadata: {
    readonly assetId: string | null;
    readonly sourceId: string | null;
    readonly kind: string | null;
  };
}

export interface VectorSearchOptions {
  /** Number of neighbours, 1..4096. */
  readonly k: number;
  readonly filter?: VectorFilter;
}

export interface VectorIndex {
  readonly name: string;
  readonly dimensions: number;
  readonly metric: VectorMetric;
  /** Inserts or replaces, atomically. Returns how many were written. */
  upsert(items: readonly VectorItem[]): Result<number>;
  /** Returns how many existed. */
  remove(ids: readonly string[]): Result<number>;
  removeWhere(filter: VectorFilter): Result<number>;
  /**
   * Every id the filter matches, every id without one: a metadata read, not a search, so there is no neighbour
   * limit. The order is unspecified. A reconciler lists what an index holds with it (LRN1-TPL: the template index
   * drops templates deleted while it wasn't open). A filter with an empty list matches nothing.
   */
  ids(filter?: VectorFilter): Result<string[]>;
  /**
   * One owner's set in place of its last one, atomically: upserts `items`, then removes the ids that match `filter`
   * and aren't among them (an asset's vectors of the kinds one stage writes). Returns how many were removed. A filter
   * with no fields is refused, as with `removeWhere`.
   */
  replaceWhere(filter: VectorFilter, items: readonly VectorItem[]): Result<number>;
  /** The k nearest vectors that match the filter, nearest first. Exact (brute force), not approximate. */
  search(query: Float32Array | readonly number[], options: VectorSearchOptions): Result<VectorMatch[]>;
  /**
   * The stored vectors with these ids (unit length in a cosine index); ids not in the index are absent
   * from the map. Find similar and near-duplicates use stored vectors as queries.
   */
  get(ids: readonly string[]): Result<Map<string, Float32Array>>;
  count(): number;
  /** Deletes the index and its vectors. */
  drop(): Result<void>;
}

/** The index of the active embedding space (`Embedder.space.indexName`), opened by the composition root. */
export const EmbeddingIndexToken = createToken<VectorIndex>('core.embeddingIndex');

/**
 * The templates' index in the active embedding space (LRN1-TPL): slot intents and one text per template. It is kept
 * apart from the library's index so a library search never scans template vectors, and it follows the active space the
 * same way: the composition root opens `templateIndexName(space.indexName)` and registers it as TemplateIndexToken.
 */
export const TemplateIndexToken = createToken<VectorIndex>('core.templateIndex');

/** The template index's name in a space, e.g. 'eg2_q4_daa72c5_tpl'. */
export function templateIndexName(spaceIndexName: string): string {
  return `${spaceIndexName}_tpl`;
}

/**
 * The memory index in the active embedding space (LRN1-MEM): one vector per memory item, id = the item's id,
 * metadata `kind` = its scope ('user', 'project', 'template') and `sourceId` = its project's or template's id (null in
 * the user scope). Kept apart so a library or template search never scans it. The composition root opens
 * `memoryIndexName(space.indexName)` in the agent process and registers it as MemoryIndexToken; the library's memory
 * indexer rebuilds it from the store, so a new space fills itself.
 */
export const MemoryIndexToken = createToken<VectorIndex>('core.memoryIndex');

/** The memory index's name in a space, e.g. 'eg2_q4_daa72c5_mem'. */
export function memoryIndexName(spaceIndexName: string): string {
  return `${spaceIndexName}_mem`;
}
