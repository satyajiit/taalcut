// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ConflictError,
  err,
  NotFoundError,
  ok,
  productSchema,
  ValidationError,
  type ProductId,
  type ProductStore,
  type Result,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import type { CommandStager } from '../ports/staging';
import { pageSize } from '../repositories/shared';
import { stagedWriter } from '../stores/staged-write';
import { productRows, productRow } from './rows';
import { productContentStore } from './content-store';
import { productScheduleStore } from './schedule-store';
import { productNotificationStore } from './notification-store';

export function createProductStore(
  db: LibraryDatabase,
  options: { commands?: CommandStager } = {},
): ProductStore {
  const write = stagedWriter(db, options.commands, 'product');
  const row = (id: ProductId) => db.driver.prepare('SELECT * FROM products WHERE id = ?').get(id);
  const get: ProductStore['get'] = async (id) => {
    const found = row(id);
    return found ? productRow(found, productSchema) : err(NotFoundError({ entity: 'product', id }));
  };
  return {
    get,
    async list(input = {}) {
      const clause = input.archived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL';
      return productRows(
        db.driver
          .prepare(
            `SELECT body_json FROM products WHERE ${clause}
        AND id > ? ORDER BY id LIMIT ?`,
          )
          .all(input.after ?? '', pageSize(input.limit, 50, 201)),
        productSchema,
      );
    },
    async save(product, expectedRevision, context) {
      const parsed = productSchema.safeParse(product);
      if (!parsed.success || product.revision !== expectedRevision + 1)
        return err(ValidationError({ field: 'product.revision' }));
      const check = (): Result<void> =>
        (row(product.id)?.['revision'] ?? 0) === expectedRevision
          ? ok(undefined)
          : err(ConflictError({ entity: 'product', id: product.id }));
      return write(context, check, () => {
        db.driver
          .prepare(
            `INSERT INTO products(id, revision, archived_at, updated_at, body_json) VALUES(?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, archived_at=excluded.archived_at,
          updated_at=excluded.updated_at, body_json=excluded.body_json`,
          )
          .run(
            product.id,
            product.revision,
            product.archivedAt,
            product.updatedAt,
            JSON.stringify(parsed.data),
          );
        db.driver
          .prepare(
            `DELETE FROM product_knowledge WHERE product_id=? AND source_id NOT IN
          (SELECT json_extract(value,'$.id') FROM json_each(?))`,
          )
          .run(product.id, JSON.stringify(product.sources));
      });
    },
    async forProject(projectId) {
      const found = db.driver
        .prepare(
          `SELECT p.body_json FROM products p
        JOIN product_campaigns c ON c.product_id=p.id WHERE c.project_id=? LIMIT 1`,
        )
        .get(projectId);
      return found ? productRow(found, productSchema) : ok(null);
    },
    ...productContentStore(db, options.commands),
    ...productScheduleStore(db, options.commands),
    ...productNotificationStore(db, options.commands),
  };
}
