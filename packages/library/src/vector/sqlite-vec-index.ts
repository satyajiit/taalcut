// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * VectorIndex on sqlite-vec's vec0 virtual table, in the library database.
 *
 * Cosine indexes store unit-length vectors and search with L2, which ranks the
 * same as cosine (|a−b|² = 2 − 2·cos) but runs on sqlite-vec's SIMD L2 kernel:
 * about 4x faster than its cosine metric at 768 dimensions. Distances are
 * converted back to cosine distance on the way out.
 */
import { err, ok, ValidationError, type Result } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import type { SqlValue } from '../driver/types';
import { VectorExtensionUnavailable, VectorIndexMismatch } from '../errors';
import { inTransaction } from '../repositories/shared';
import { sqliteVecVersion } from './extension';
import type {
  VectorFilter,
  VectorIndex,
  VectorItem,
  VectorMatch,
  VectorMetric,
  VectorSearchOptions,
} from './types';

export interface VectorIndexOptions {
  /** Lower-case letters, digits and '_'. The vec0 table is `vec_<name>`. Default 'default'. */
  readonly name?: string;
  /** Default 768 (EmbeddingGemma 2). */
  readonly dimensions?: number;
  /** Default 'cosine'. */
  readonly metric?: VectorMetric;
}

const MAX_K = 4096;
const FILTER_COLUMNS = { assetId: 'asset_id', sourceId: 'source_id', kind: 'kind' } as const;

function toBlob(
  values: Float32Array | readonly number[],
  dimensions: number,
  normalize: boolean,
): Result<Uint8Array> {
  if (values.length !== dimensions) {
    return err(
      ValidationError(
        { field: 'vector' },
        { detail: `expected ${dimensions} dimensions, got ${values.length}` },
      ),
    );
  }
  const vector = Float32Array.from(values);
  let norm = 0;
  for (const v of vector) {
    if (!Number.isFinite(v)) return err(ValidationError({ field: 'vector' }, { detail: 'non-finite value' }));
    norm += v * v;
  }
  if (normalize) {
    if (norm === 0)
      return err(ValidationError({ field: 'vector' }, { detail: 'zero vector has no direction' }));
    const scale = 1 / Math.sqrt(norm);
    for (let i = 0; i < vector.length; i++) vector[i] = vector[i]! * scale;
  }
  return ok(new Uint8Array(vector.buffer));
}

/** SQL and parameters for the metadata part of a WHERE clause; null if a filter list is empty (no match). */
function filterSql(filter: VectorFilter = {}): { sql: string; params: SqlValue[] } | null {
  const parts: string[] = [];
  const params: SqlValue[] = [];
  for (const [field, column] of Object.entries(FILTER_COLUMNS)) {
    const value = filter[field as keyof VectorFilter];
    if (value === undefined) continue;
    if (typeof value === 'string') {
      parts.push(`${column} = ?`);
      params.push(value);
    } else {
      if (value.length === 0) return null;
      parts.push(`${column} IN (${value.map(() => '?').join(', ')})`);
      params.push(...value);
    }
  }
  return { sql: parts.map((p) => ` AND ${p}`).join(''), params };
}

class SqliteVecIndex implements VectorIndex {
  private readonly table: string;

  constructor(
    private readonly db: LibraryDatabase,
    readonly name: string,
    readonly dimensions: number,
    readonly metric: VectorMetric,
  ) {
    this.table = `vec_${name}`;
  }

  upsert(items: readonly VectorItem[]): Result<number> {
    const rows: SqlValue[][] = [];
    for (const item of items) {
      if (!item.id) return err(ValidationError({ field: 'id' }));
      const blob = toBlob(item.vector, this.dimensions, this.metric === 'cosine');
      if (!blob.ok) return blob;
      const m = item.metadata ?? {};
      rows.push([blob.value, m.assetId ?? '', m.sourceId ?? '', m.kind ?? '', item.id]);
    }
    const { driver } = this.db;
    const exists = driver.prepare(`SELECT 1 AS found FROM ${this.table} WHERE item_id = ?`);
    const update = driver.prepare(
      `UPDATE ${this.table} SET embedding = ?, asset_id = ?, source_id = ?, kind = ? WHERE item_id = ?`,
    );
    const insert = driver.prepare(
      `INSERT INTO ${this.table} (embedding, asset_id, source_id, kind, item_id) VALUES (?, ?, ?, ?, ?)`,
    );
    return inTransaction(this.db, 'vector', () => {
      for (const row of rows) (exists.get(row[4]!) ? update : insert).run(...row);
      return ok(rows.length);
    });
  }

  remove(ids: readonly string[]): Result<number> {
    const del = this.db.driver.prepare(`DELETE FROM ${this.table} WHERE item_id = ?`);
    return inTransaction(this.db, 'vector', () => ok(ids.reduce((n, id) => n + del.run(id).changes, 0)));
  }

  removeWhere(filter: VectorFilter): Result<number> {
    const where = filterSql(filter);
    if (!where) return ok(0);
    if (!where.sql)
      return err(ValidationError({ field: 'filter' }, { detail: 'refusing to remove everything' }));
    return inTransaction(this.db, 'vector', () => this.remove(this.idsWhere(where)));
  }

  ids(filter?: VectorFilter): Result<string[]> {
    const where = filterSql(filter);
    return ok(where ? this.idsWhere(where) : []);
  }

  replaceWhere(filter: VectorFilter, items: readonly VectorItem[]): Result<number> {
    const where = filterSql(filter);
    if (where && !where.sql)
      return err(ValidationError({ field: 'filter' }, { detail: 'refusing to replace everything' }));
    return inTransaction(this.db, 'vector', () => {
      const written = this.upsert(items);
      if (!written.ok) return written;
      if (!where) return ok(0);
      const keep = new Set(items.map((item) => item.id));
      return this.remove(this.idsWhere(where).filter((id) => !keep.has(id)));
    });
  }

  /** Every id the filter matches: a metadata select, not a search, so there is no neighbour limit. */
  private idsWhere(where: { sql: string; params: SqlValue[] }): string[] {
    return this.db.driver
      .prepare(`SELECT item_id FROM ${this.table} WHERE 1${where.sql}`)
      .values(...where.params)
      .map((row) => String(row[0]));
  }

  search(query: Float32Array | readonly number[], options: VectorSearchOptions): Result<VectorMatch[]> {
    if (!Number.isInteger(options.k) || options.k < 1 || options.k > MAX_K) {
      return err(ValidationError({ field: 'k' }, { detail: `k must be 1..${MAX_K}` }));
    }
    const blob = toBlob(query, this.dimensions, this.metric === 'cosine');
    if (!blob.ok) return blob;
    const where = filterSql(options.filter);
    if (!where) return ok([]);
    const rows = this.db.driver
      .prepare(
        `SELECT item_id, distance, asset_id, source_id, kind FROM ${this.table}
         WHERE embedding MATCH ? AND k = ?${where.sql} ORDER BY distance`,
      )
      .values(blob.value, options.k, ...where.params);
    const cosine = this.metric === 'cosine';
    return ok(
      rows.map(([id, distance, assetId, sourceId, kind]) => {
        const d = Number(distance);
        return {
          id: String(id),
          distance: cosine ? (d * d) / 2 : d,
          metadata: {
            assetId: (assetId as string) || null,
            sourceId: (sourceId as string) || null,
            kind: (kind as string) || null,
          },
        };
      }),
    );
  }

  get(ids: readonly string[]): Result<Map<string, Float32Array>> {
    const found = new Map<string, Float32Array>();
    const unique = [...new Set(ids)];
    if (unique.length === 0) return ok(found);
    const BATCH = 500;
    for (let start = 0; start < unique.length; start += BATCH) {
      const batch = unique.slice(start, start + BATCH);
      const placeholders = batch.map(() => '?').join(', ');
      const rows = this.db.driver
        .prepare(`SELECT item_id, embedding FROM ${this.table} WHERE item_id IN (${placeholders})`)
        .values(...batch);
      for (const [id, blob] of rows) {
        if (typeof id !== 'string' || !(blob instanceof Uint8Array)) continue;
        // Copy: the driver's buffer may be reused, and a Float32Array needs 4-byte alignment.
        found.set(id, new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength)));
      }
    }
    return ok(found);
  }

  count(): number {
    return Number(this.db.driver.prepare(`SELECT count(*) AS n FROM ${this.table}`).get()?.n ?? 0);
  }

  drop(): Result<void> {
    return inTransaction(this.db, 'vector', () => {
      this.db.driver.exec(`DROP TABLE IF EXISTS ${this.table}`);
      this.db.driver.prepare('DELETE FROM vector_indexes WHERE name = ?').run(this.name);
      return ok(undefined);
    });
  }
}

/**
 * Opens (creating if needed) a vector index in the library database. The
 * database must have sqlite-vec loaded (`openDatabase({ extensions:
 * [sqliteVecPath()] })`). Errors: VectorExtensionUnavailable;
 * VectorIndexMismatch if the index exists with other dimensions or metric.
 */
export function openVectorIndex(db: LibraryDatabase, options: VectorIndexOptions = {}): Result<VectorIndex> {
  const name = options.name ?? 'default';
  const dimensions = options.dimensions ?? 768;
  const metric = options.metric ?? 'cosine';
  if (!/^[a-z][a-z0-9_]{0,47}$/.test(name)) return err(ValidationError({ field: 'name' }, { detail: name }));
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 8192) {
    return err(ValidationError({ field: 'dimensions' }));
  }
  if (!sqliteVecVersion(db.driver)) {
    return err(
      VectorExtensionUnavailable(undefined, { detail: 'sqlite-vec is not loaded into this connection' }),
    );
  }
  return inTransaction(db, 'vector_index', () => {
    const existing = db.driver
      .prepare('SELECT dimensions, metric FROM vector_indexes WHERE name = ?')
      .get(name);
    if (existing && (existing.dimensions !== dimensions || existing.metric !== metric)) {
      const detail = `exists with ${existing.dimensions} dimensions (${existing.metric})`;
      return err(VectorIndexMismatch({ name }, { detail }));
    }
    if (!existing) {
      db.driver
        .prepare('INSERT INTO vector_indexes (name, dimensions, metric, created_at) VALUES (?, ?, ?, ?)')
        .run(name, dimensions, metric, db.clock());
    }
    // Metadata columns can't hold NULL in vec0, so "missing" is stored as ''.
    db.driver.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS vec_${name} USING vec0(
        item_id TEXT PRIMARY KEY, embedding float[${dimensions}], asset_id TEXT, source_id TEXT, kind TEXT)`,
    );
    return ok(new SqliteVecIndex(db, name, dimensions, metric));
  });
}
