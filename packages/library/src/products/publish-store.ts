// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ConflictError,
  err,
  ok,
  parseId,
  productPublishRecordSchema,
  ValidationError,
  type ProductPublishRecord,
  type ProductPublishStore,
  type Result,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import type { SqlValue } from '../driver/types';
import { inTransaction, pageSize } from '../repositories/shared';

function decode(value: unknown): Result<ProductPublishRecord> {
  try {
    const parsed = productPublishRecordSchema.safeParse(
      typeof value === 'string' ? JSON.parse(value) : value,
    );
    if (parsed.success) return ok(parsed.data);
  } catch {
    /* Corrupt persisted JSON is a recoverable library error. */
  }
  return err(ValidationError({ field: 'productPublication' }));
}

/** External effects survive restarts; every transition compares the revision reserved by its caller. */
export function createProductPublishStore(db: LibraryDatabase): ProductPublishStore {
  const find = db.driver.prepare('SELECT body_json FROM product_publications WHERE id = ?');
  return {
    async readReconcileCursor() {
      const value = db.driver
        .prepare('SELECT after_id FROM product_publish_reconcile_cursor WHERE singleton=1')
        .get()?.['after_id'];
      return value == null ? ok(null) : parseId<'ProductPublish'>(value);
    },
    async saveReconcileCursor(afterId) {
      return inTransaction(db, 'productPublication', () => {
        if (afterId !== null) {
          const valid = parseId<'ProductPublish'>(afterId);
          if (!valid.ok) return valid;
        }
        db.driver
          .prepare('UPDATE product_publish_reconcile_cursor SET after_id=? WHERE singleton=1')
          .run(afterId);
        return ok(undefined);
      });
    },
    async get(id) {
      const row = find.get(id);
      return row ? decode(row['body_json']) : ok(null);
    },
    async list(input = {}) {
      const where: string[] = [];
      const params: SqlValue[] = [];
      if (input.campaignId) {
        where.push('campaign_id = ?');
        params.push(input.campaignId);
      }
      if (input.statuses) {
        if (!input.statuses.length) return ok([]);
        where.push(`status IN (${input.statuses.map(() => '?').join(',')})`);
        params.push(...input.statuses);
      }
      if (input.afterId) {
        where.push('id > ?');
        params.push(input.afterId);
      }
      const order = input.afterId === undefined ? 'updated_at DESC, id DESC' : 'id ASC';
      const rows = db.driver
        .prepare(
          `SELECT body_json FROM product_publications ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ${order} LIMIT ?`,
        )
        .all(...params, pageSize(input.limit));
      const records: ProductPublishRecord[] = [];
      for (const row of rows) {
        const decoded = decode(row['body_json']);
        if (!decoded.ok) return decoded;
        records.push(decoded.value);
      }
      return ok(records);
    },
    async create(records) {
      return inTransaction(db, 'productPublication', () => {
        for (const record of records) {
          const parsed = decode(record);
          if (!parsed.ok) return parsed;
          if (record.revision !== 1 || record.status !== 'draft' || record.approvalHash !== null) {
            return err(ValidationError({ field: 'publicationRevision' }));
          }
          db.driver
            .prepare(
              `INSERT INTO product_publications
            (id,batch_id,product_id,campaign_id,status,revision,updated_at,body_json) VALUES (?,?,?,?,?,?,?,?)`,
            )
            .run(
              record.id,
              record.batchId,
              record.productId,
              record.campaignId,
              record.status,
              record.revision,
              record.updatedAt,
              JSON.stringify(parsed.value),
            );
        }
        return ok(undefined);
      });
    },
    async update(record, expectedRevision) {
      const parsed = decode(record);
      if (!parsed.ok) return parsed;
      if (record.revision !== expectedRevision + 1)
        return err(ValidationError({ field: 'publicationRevision' }));
      return inTransaction(db, 'productPublication', () => {
        const previous = find.get(record.id);
        const old = previous ? decode(previous['body_json']) : null;
        if (
          !old?.ok ||
          old.value.productId !== record.productId ||
          old.value.campaignId !== record.campaignId ||
          old.value.batchId !== record.batchId ||
          old.value.revision !== expectedRevision
        ) {
          return err(ConflictError({ entity: 'productPublication', id: record.id }));
        }
        const changed = db.driver
          .prepare(
            `UPDATE product_publications SET status=?,revision=?,updated_at=?,body_json=?
          WHERE id=? AND revision=?`,
          )
          .run(
            record.status,
            record.revision,
            record.updatedAt,
            JSON.stringify(parsed.value),
            record.id,
            expectedRevision,
          );
        return changed.changes === 1
          ? ok(undefined)
          : err(ConflictError({ entity: 'productPublication', id: record.id }));
      });
    },
  };
}
