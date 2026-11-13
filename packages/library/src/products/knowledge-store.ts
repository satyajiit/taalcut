// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, ok, productKnowledgeSchema, ValidationError, type ProductStore } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { pageSize } from '../repositories/shared';
import { productRows } from './rows';

const COVERAGE = 'taalcut:index-coverage';
const RECALL_LIMIT = 200;
const CURSOR = /^([cd]):([0-9A-HJKMNP-TV-Z]{26})$/;

/** Tokenize user words instead of accepting FTS operators; product scope is itself an indexed term. */
function matchQuery(productId: string, query: string): string | null {
  const words = [...new Set(query.toLocaleLowerCase('en').match(/[\p{L}\p{N}_]{2,}/gu) ?? [])].slice(0, 24);
  if (!words.length) return null;
  const terms = words.map((word) => `{title text}:"${word}"*`).join(' OR ');
  return `product_id:"${productId}" AND (${terms})`;
}

export function productKnowledgeStore(
  db: LibraryDatabase,
): Pick<ProductStore, 'knowledge' | 'knowledgePage' | 'knowledgeByIds'> {
  const coverage = (productId: string, after: string, limit: number) =>
    db.driver
      .prepare(
        `SELECT body_json FROM product_knowledge WHERE product_id=? AND locator=? AND id>? ORDER BY id LIMIT ?`,
      )
      .all(productId, COVERAGE, after, limit);

  return {
    async knowledgeByIds(productId, ids) {
      if (ids.length > 100) return err(ValidationError({ field: 'knowledgeIds' }));
      const unique = [...new Set(ids)];
      if (!unique.length) return ok([]);
      return productRows(
        db.driver
          .prepare(
            `SELECT body_json FROM product_knowledge WHERE product_id=? AND id IN (${unique.map(() => '?').join(',')}) ORDER BY id`,
          )
          .all(productId, ...unique),
        productKnowledgeSchema,
      );
    },
    async knowledgePage(productId, input = {}) {
      const cursor = input.after ? CURSOR.exec(input.after) : null;
      if (input.after && !cursor) return err(ValidationError({ field: 'after' }));
      const limit = pageSize(input.limit, 50, 200);
      const notices = cursor?.[1] === 'd' ? [] : coverage(productId, cursor?.[2] ?? '', limit + 1);
      const text = input.query?.trim();
      const match = text ? matchQuery(productId, text) : undefined;
      const documents =
        notices.length > limit || match === null
          ? []
          : db.driver
              .prepare(
                `SELECT body_json FROM product_knowledge WHERE product_id=? AND locator<>? AND id>?
        ${match ? 'AND rowid IN (SELECT rowid FROM product_knowledge_fts WHERE product_knowledge_fts MATCH ?)' : ''}
        ORDER BY id LIMIT ?`,
              )
              .all(
                productId,
                COVERAGE,
                cursor?.[1] === 'd' ? cursor[2]! : '',
                ...(match ? [match] : []),
                limit + 1 - notices.length,
              );
      const parsed = productRows([...notices, ...documents], productKnowledgeSchema);
      if (!parsed.ok) return parsed;
      const items = parsed.value.slice(0, limit);
      const last = items.at(-1);
      return ok({
        items,
        nextCursor:
          parsed.value.length > limit && last ? `${last.locator === COVERAGE ? 'c' : 'd'}:${last.id}` : null,
      });
    },

    async knowledge(productId, query) {
      const notices = productRows(coverage(productId, '', RECALL_LIMIT), productKnowledgeSchema);
      if (!notices.ok) return notices;
      const remaining = RECALL_LIMIT - notices.value.length;
      if (!remaining) return notices;
      const text = query?.trim();
      const match = text ? matchQuery(productId, text) : undefined;
      if (match === null) return notices;
      // SQLite ranks candidates; only the bounded selection crosses into JS. Round-robin source positions
      // prevent a large repository from consuming the whole recall window before a later attached source.
      const scored = match
        ? `SELECT k.rowid AS rid,k.id,k.source_id,bm25(product_knowledge_fts,0,4,1) AS score
          FROM product_knowledge_fts JOIN product_knowledge k ON k.rowid=product_knowledge_fts.rowid
          WHERE product_knowledge_fts MATCH ? AND k.product_id=? AND k.locator<>?`
        : `SELECT rowid AS rid,id,source_id,0 AS score FROM product_knowledge
          WHERE product_id=? AND locator<>?`;
      const documents = productRows(
        db.driver
          .prepare(
            `WITH scored AS MATERIALIZED (${scored}), ranked AS (
          SELECT rid,id,score,ROW_NUMBER() OVER(PARTITION BY source_id ORDER BY score,id) AS position FROM scored
        ) SELECT k.body_json FROM ranked r JOIN product_knowledge k ON k.rowid=r.rid
        ORDER BY r.position,r.score,r.id LIMIT ?`,
          )
          .all(...(match ? [match] : []), productId, COVERAGE, remaining),
        productKnowledgeSchema,
      );
      return documents.ok ? ok([...notices.value, ...documents.value]) : documents;
    },
  };
}
