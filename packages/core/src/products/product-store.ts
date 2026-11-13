// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { AsyncResult } from '../basics/result';
import type { CommandContext } from '../commands/definition';
import type { CreationSourceInput } from '../creation/creation-types';
import type { ProjectId } from '../basics/ids';
import type { Product, ProductCampaign, ProductId, ProductIdea, ProductKnowledge } from './product-schema';
import type { ProductNotification, ProductOccurrence, ProductSchedule } from './product-schedule';

export interface ProductStore {
  get(id: ProductId): AsyncResult<Product>;
  list(input?: { after?: ProductId; limit?: number; archived?: boolean }): AsyncResult<readonly Product[]>;
  save(product: Product, expectedRevision: number, context?: CommandContext): AsyncResult<void>;
  forProject(projectId: ProjectId): AsyncResult<Product | null>;
  knowledge(productId: ProductId, query?: string): AsyncResult<readonly ProductKnowledge[]>;
  knowledgeByIds(
    productId: ProductId,
    ids: readonly ProductKnowledge['id'][],
  ): AsyncResult<readonly ProductKnowledge[]>;
  knowledgePage(
    productId: ProductId,
    input?: { after?: string; limit?: number; query?: string },
  ): AsyncResult<{ items: ProductKnowledge[]; nextCursor: string | null }>;
  replaceKnowledge(
    productId: ProductId,
    sourceId: CreationSourceInput['id'],
    items: readonly ProductKnowledge[],
  ): AsyncResult<void>;
  ideas(
    productId: ProductId,
    input?: { before?: string; since?: number; limit?: number },
  ): AsyncResult<readonly ProductIdea[]>;
  getIdea(id: ProductIdea['id']): AsyncResult<ProductIdea>;
  hasRecentFeature(
    productId: ProductId,
    featureKey: string,
    since: number,
    novelty?: { angle: string; digests: readonly string[] },
  ): AsyncResult<boolean>;
  saveIdeas(ideas: readonly ProductIdea[], occurrenceId?: ProductOccurrence['id']): AsyncResult<void>;
  saveIdea(idea: ProductIdea, context?: CommandContext): AsyncResult<void>;
  campaigns(
    productId: ProductId,
    input?: { before?: string; since?: number; limit?: number },
  ): AsyncResult<readonly ProductCampaign[]>;
  getCampaign(id: ProductCampaign['id']): AsyncResult<ProductCampaign>;
  campaignForIdea(id: ProductIdea['id']): AsyncResult<ProductCampaign | null>;
  campaignForProject(id: ProjectId): AsyncResult<ProductCampaign | null>;
  pendingCampaigns(input?: { after?: string; limit?: number }): AsyncResult<readonly ProductCampaign[]>;
  saveCampaign(campaign: ProductCampaign, expectedRevision: number): AsyncResult<void>;
  /** Atomically reserves an idea; its existing campaign is returned on retries. */
  reserveCampaign(campaign: ProductCampaign): AsyncResult<ProductCampaign>;
  listSchedules(): AsyncResult<readonly ProductSchedule[]>;
  getSchedule(productId: ProductId): AsyncResult<ProductSchedule | null>;
  listDue(now: number, limit?: number): AsyncResult<readonly ProductSchedule[]>;
  saveSchedule(schedule: ProductSchedule, context?: CommandContext): AsyncResult<void>;
  claimOccurrence(input: {
    productId: ProductId;
    scheduledFor: number;
    now: number;
    leaseUntil: number;
    nextRunAt: number;
  }): AsyncResult<ProductOccurrence | null>;
  expiredOccurrences(now: number, limit?: number): AsyncResult<readonly ProductOccurrence[]>;
  getOccurrence(id: ProductOccurrence['id']): AsyncResult<ProductOccurrence>;
  settleOccurrence(
    id: ProductOccurrence['id'],
    result: { state: 'completed' | 'failed'; detail?: string },
  ): AsyncResult<void>;
  appendNotification(notification: ProductNotification): AsyncResult<void>;
  listNotifications(input?: {
    productId?: ProductId;
    unreadOnly?: boolean;
    limit?: number;
  }): AsyncResult<readonly ProductNotification[]>;
  readNotification(id: ProductNotification['id'], at: number, context?: CommandContext): AsyncResult<void>;
}
