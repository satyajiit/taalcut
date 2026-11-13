// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ConflictError,
  err,
  NotFoundError,
  normalizeProductFeatureKey,
  similarProductAngle,
  ok,
  productCampaignSchema,
  productIdeaSchema,
  productOccurrenceSchema,
  productKnowledgeSchema,
  productSchema,
  ValidationError,
  type ProductStore,
  type Result,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import type { CommandStager } from '../ports/staging';
import { inTransaction, pageSize } from '../repositories/shared';
import { stagedWriter } from '../stores/staged-write';
import { productRow, productRows } from './rows';
import { productKnowledgeStore } from './knowledge-store';

type ContentMethods = Pick<
  ProductStore,
  | 'knowledge'
  | 'knowledgePage'
  | 'knowledgeByIds'
  | 'replaceKnowledge'
  | 'ideas'
  | 'getIdea'
  | 'hasRecentFeature'
  | 'saveIdeas'
  | 'saveIdea'
  | 'campaigns'
  | 'getCampaign'
  | 'campaignForIdea'
  | 'campaignForProject'
  | 'pendingCampaigns'
  | 'saveCampaign'
  | 'reserveCampaign'
>;
export function productContentStore(db: LibraryDatabase, commands?: CommandStager): ContentMethods {
  const write = stagedWriter(db, commands, 'productContent');
  return {
    ...productKnowledgeStore(db),
    async pendingCampaigns(input = {}) {
      return productRows(
        db.driver
          .prepare(
            `SELECT c.body_json FROM product_campaigns c JOIN products p ON p.id=c.product_id
        WHERE p.archived_at IS NULL AND json_extract(c.body_json,'$.status')='draft' AND c.id>? ORDER BY c.id LIMIT ?`,
          )
          .all(input.after ?? '', pageSize(input.limit, 100, 1000)),
        productCampaignSchema,
      );
    },
    async campaignForProject(id) {
      const row = db.driver.prepare('SELECT body_json FROM product_campaigns WHERE project_id=?').get(id);
      return row ? productRow(row, productCampaignSchema) : ok(null);
    },
    async hasRecentFeature(productId, featureKey, since, novelty) {
      let after = '';
      while (true) {
        const rows = productRows(
          db.driver
            .prepare(
              `SELECT body_json FROM product_ideas
          WHERE product_id=? AND feature_key=? AND created_at>=? AND id>? ORDER BY id LIMIT 200`,
            )
            .all(productId, normalizeProductFeatureKey(featureKey), since, after),
          productIdeaSchema,
        );
        if (!rows.ok) return rows;
        if (!rows.value.length) return ok(false);
        if (
          !novelty ||
          rows.value.some(
            (idea) =>
              similarProductAngle(novelty.angle, idea.angle) &&
              novelty.digests.every((digest) => idea.evidence.some((evidence) => evidence.digest === digest)),
          )
        )
          return ok(true);
        after = rows.value.at(-1)!.id;
      }
    },
    async campaignForIdea(id) {
      const row = db.driver.prepare('SELECT body_json FROM product_campaigns WHERE idea_id=?').get(id);
      return row ? productRow(row, productCampaignSchema) : ok(null);
    },
    async getIdea(id) {
      const row = db.driver.prepare('SELECT body_json FROM product_ideas WHERE id=?').get(id);
      return row ? productRow(row, productIdeaSchema) : err(NotFoundError({ entity: 'productIdea', id }));
    },
    async getCampaign(id) {
      const row = db.driver.prepare('SELECT body_json FROM product_campaigns WHERE id=?').get(id);
      return row
        ? productRow(row, productCampaignSchema)
        : err(NotFoundError({ entity: 'productCampaign', id }));
    },
    async replaceKnowledge(productId, sourceId, items) {
      const parsed = productKnowledgeSchema.array().safeParse(items);
      if (!parsed.success || items.some((item) => item.productId !== productId || item.sourceId !== sourceId))
        return err(ValidationError({ field: 'knowledge' }));
      return inTransaction(db, 'productKnowledge', () => {
        const parent = db.driver.prepare('SELECT body_json FROM products WHERE id=?').get(productId);
        if (!parent) return err(NotFoundError({ entity: 'product', id: productId }));
        const product = productRow(parent, productSchema);
        if (!product.ok) return product;
        if (!product.value.sources.some((source) => source.id === sourceId))
          return err(ConflictError({ entity: 'productSource', id: sourceId }));
        const old = new Map(
          db.driver
            .prepare('SELECT id,locator,digest FROM product_knowledge WHERE product_id=? AND source_id=?')
            .all(productId, sourceId)
            .map((row) => [row['locator'], row]),
        );
        db.driver
          .prepare('DELETE FROM product_knowledge WHERE product_id=? AND source_id=?')
          .run(productId, sourceId);
        for (const item of parsed.data) {
          const same = old.get(item.locator);
          const id = same?.['digest'] === item.digest ? String(same['id']) : item.id;
          db.driver
            .prepare(
              'INSERT INTO product_knowledge(id,product_id,source_id,locator,digest,body_json) VALUES(?,?,?,?,?,?)',
            )
            .run(id, productId, sourceId, item.locator, item.digest, JSON.stringify({ ...item, id }));
        }
        return ok(undefined);
      });
    },
    async ideas(productId, input = {}) {
      return productRows(
        db.driver
          .prepare(
            `SELECT body_json FROM product_ideas WHERE product_id=?
        AND id<? AND created_at>=? ORDER BY id DESC LIMIT ?`,
          )
          .all(
            productId,
            input.before ?? 'ZZZZZZZZZZZZZZZZZZZZZZZZZZ',
            input.since ?? 0,
            pageSize(input.limit, 100, 1000),
          ),
        productIdeaSchema,
      );
    },
    async saveIdeas(ideas, occurrenceId) {
      const parsed = productIdeaSchema.array().safeParse(ideas);
      if (!parsed.success) return err(ValidationError({ field: 'ideas' }));
      return inTransaction(db, 'productIdea', () => {
        if (occurrenceId) {
          const row = db.driver
            .prepare('SELECT body_json FROM product_occurrences WHERE id=?')
            .get(occurrenceId);
          if (!row) return err(NotFoundError({ entity: 'productOccurrence', id: occurrenceId }));
          const occurrence = productRow(row, productOccurrenceSchema);
          if (!occurrence.ok) return occurrence;
          if (
            occurrence.value.state !== 'running' ||
            occurrence.value.ideaIds !== undefined ||
            ideas.some((idea) => idea.productId !== occurrence.value.productId)
          )
            return err(ConflictError({ entity: 'productOccurrence', id: occurrenceId }));
          db.driver
            .prepare('UPDATE product_occurrences SET body_json=? WHERE id=?')
            .run(
              JSON.stringify({ ...occurrence.value, ideaIds: ideas.map((idea) => idea.id) }),
              occurrenceId,
            );
        }
        for (const idea of parsed.data)
          db.driver
            .prepare(
              'INSERT INTO product_ideas(id,product_id,status,feature_key,created_at,body_json) VALUES(?,?,?,?,?,?)',
            )
            .run(
              idea.id,
              idea.productId,
              idea.status,
              normalizeProductFeatureKey(idea.featureKey),
              idea.createdAt,
              JSON.stringify(idea),
            );
        return ok(undefined);
      });
    },
    async saveIdea(idea, context) {
      const parsed = productIdeaSchema.safeParse(idea);
      if (!parsed.success) return err(ValidationError({ field: 'idea' }));
      const check = (): Result<void> => {
        const row = db.driver.prepare('SELECT product_id,status FROM product_ideas WHERE id=?').get(idea.id);
        if (row?.['product_id'] !== idea.productId)
          return err(NotFoundError({ entity: 'productIdea', id: idea.id }));
        return row['status'] === 'chosen' && idea.status !== 'chosen'
          ? err(ConflictError({ entity: 'productIdea', id: idea.id }))
          : ok(undefined);
      };
      return write(context, check, () => {
        db.driver
          .prepare('UPDATE product_ideas SET status=?,body_json=? WHERE id=?')
          .run(idea.status, JSON.stringify(parsed.data), idea.id);
      });
    },
    async campaigns(productId, input = {}) {
      return productRows(
        db.driver
          .prepare(
            `SELECT body_json FROM product_campaigns WHERE product_id=?
        AND id<? AND created_at>=? ORDER BY id DESC LIMIT ?`,
          )
          .all(
            productId,
            input.before ?? 'ZZZZZZZZZZZZZZZZZZZZZZZZZZ',
            input.since ?? 0,
            pageSize(input.limit, 100, 1000),
          ),
        productCampaignSchema,
      );
    },
    async saveCampaign(campaign, expectedRevision) {
      const parsed = productCampaignSchema.safeParse(campaign);
      if (!parsed.success || campaign.revision !== expectedRevision + 1)
        return err(ValidationError({ field: 'campaign.revision' }));
      return inTransaction(db, 'productCampaign', () => {
        const row = db.driver
          .prepare('SELECT revision,product_id,idea_id,project_id FROM product_campaigns WHERE id=?')
          .get(campaign.id);
        if (
          row?.['revision'] !== expectedRevision ||
          row['product_id'] !== campaign.productId ||
          row['idea_id'] !== campaign.ideaId ||
          row['project_id'] !== campaign.projectId
        )
          return err(ConflictError({ entity: 'productCampaign', id: campaign.id }));
        db.driver
          .prepare('UPDATE product_campaigns SET revision=?,body_json=? WHERE id=?')
          .run(campaign.revision, JSON.stringify(parsed.data), campaign.id);
        return ok(undefined);
      });
    },
    async reserveCampaign(campaign) {
      const parsed = productCampaignSchema.safeParse(campaign);
      if (!parsed.success || campaign.revision !== 1) return err(ValidationError({ field: 'campaign' }));
      return inTransaction(db, 'productCampaign', () => {
        const existing = db.driver
          .prepare('SELECT body_json FROM product_campaigns WHERE product_id=? AND idea_id=?')
          .get(campaign.productId, campaign.ideaId);
        if (existing) return productRow(existing, productCampaignSchema);
        const source = db.driver
          .prepare('SELECT body_json FROM product_ideas WHERE id=? AND product_id=?')
          .get(campaign.ideaId, campaign.productId);
        if (!source) return err(NotFoundError({ entity: 'productIdea', id: campaign.ideaId }));
        const idea = productRow(source, productIdeaSchema);
        if (!idea.ok) return idea;
        if (idea.value.status !== 'suggested')
          return err(ConflictError({ entity: 'productIdea', id: campaign.ideaId }));
        db.driver
          .prepare(
            'INSERT INTO product_campaigns(id,product_id,idea_id,project_id,revision,created_at,body_json) VALUES(?,?,?,?,?,?,?)',
          )
          .run(
            campaign.id,
            campaign.productId,
            campaign.ideaId,
            campaign.projectId,
            1,
            campaign.createdAt,
            JSON.stringify(parsed.data),
          );
        db.driver
          .prepare('UPDATE product_ideas SET status=?,body_json=? WHERE id=?')
          .run(
            'chosen',
            JSON.stringify({ ...idea.value, status: 'chosen', updatedAt: campaign.updatedAt }),
            campaign.ideaId,
          );
        return ok(parsed.data);
      });
    },
  };
}
