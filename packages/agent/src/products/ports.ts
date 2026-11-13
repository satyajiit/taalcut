// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type {
  AsyncResult,
  ConversationId,
  Product,
  ProductCampaign,
  ProductIdea,
  ProductIdeaDraft,
  ProductKnowledge,
  ProductKnowledgeInput,
  ProductScheduleInput,
  ProductSource,
  ProductStore,
  ProjectId,
  Result,
} from '@taalcut/core';

export interface ProductResearchInput {
  readonly product: Product;
  readonly knowledge: readonly ProductKnowledge[];
  readonly history: readonly ProductIdea[];
}
export interface ProductCreationInput {
  readonly product: Product;
  readonly idea: ProductIdea;
  readonly campaign: ProductCampaign;
  readonly knowledge: readonly ProductKnowledge[];
}
export interface ProductServiceDeps {
  readonly store: ProductStore;
  readonly sources: {
    inspect(
      product: Product,
      source: ProductSource,
      signal: AbortSignal,
    ): AsyncResult<readonly ProductKnowledgeInput[]>;
  };
  readonly model: {
    shortlist(input: ProductResearchInput, signal: AbortSignal): AsyncResult<readonly ProductIdeaDraft[]>;
  };
  readonly creation: {
    /** Idempotent by campaign.id; use campaign.projectId for the existing authoring workflow. */
    create(
      input: ProductCreationInput,
      signal: AbortSignal,
    ): AsyncResult<{ projectId: ProjectId; conversationId: ConversationId | null }>;
  };
  readonly nextSchedule: (schedule: ProductScheduleInput, after: number) => Result<number>;
  readonly now?: () => number;
}
