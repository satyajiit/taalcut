// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  CancelledError,
  err,
  newId,
  NotFoundError,
  ok,
  type AsyncResult,
  type ProductCampaign,
  type ProductCampaignId,
  type ProductId,
  type ProductIdeaId,
} from '@taalcut/core';
import { ProductArchived, ProductDraftLimit, ProductEvidenceChanged } from './errors';
import type { ProductServiceDeps } from './ports';

export async function chooseProductIdea(
  deps: ProductServiceDeps,
  productId: ProductId,
  ideaId: ProductIdeaId,
  signal: AbortSignal,
): AsyncResult<ProductCampaign> {
  const now = deps.now ?? Date.now;
  const product = await deps.store.get(productId);
  if (!product.ok) return product;
  if (product.value.archivedAt !== null) return err(ProductArchived());
  const found = await deps.store.getIdea(ideaId);
  if (!found.ok) return found;
  const idea = found.value;
  if (idea.productId !== productId) return err(NotFoundError({ entity: 'productIdea', id: ideaId }));
  const previous = await deps.store.campaignForIdea(ideaId);
  if (!previous.ok) return previous;
  const existing = previous.value;
  if (existing && existing.revision > 1 && existing.status !== 'failed') return ok(existing);
  const campaigns = await deps.store.campaigns(productId, { since: now() - 86_400_000, limit: 1000 });
  if (!campaigns.ok) return campaigns;
  if (
    !existing &&
    campaigns.value.filter((campaign) => campaign.createdAt >= now() - 86_400_000).length >=
      product.value.preferences.maxDraftsPerDay
  )
    return err(ProductDraftLimit());
  const knowledge = await deps.store.knowledgeByIds(
    productId,
    idea.evidence.map((evidence) => evidence.knowledgeId),
  );
  if (!knowledge.ok) return knowledge;
  if (
    !idea.evidence.every((evidence) =>
      knowledge.value.some((item) => item.id === evidence.knowledgeId && item.digest === evidence.digest),
    )
  )
    return err(ProductEvidenceChanged());
  if (signal.aborted) return err(CancelledError());
  const at = now();
  const reserved = await deps.store.reserveCampaign({
    id: newId<'ProductCampaign'>(),
    productId,
    ideaId,
    projectId: newId<'Project'>(),
    conversationId: null,
    revision: 1,
    status: 'draft',
    createdAt: at,
    updatedAt: at,
  });
  if (!reserved.ok) return reserved;
  if (reserved.value.status === 'failed') {
    const { renders: _renders, ...before } = reserved.value;
    const retry = {
      ...before,
      status: 'draft' as const,
      attempts: 0,
      retryAt: null,
      lastError: null,
      revision: reserved.value.revision + 1,
      updatedAt: now(),
    };
    const saved = await deps.store.saveCampaign(retry, reserved.value.revision);
    return saved.ok ? ok(retry) : saved;
  }
  return reserved;
}

/** A durable choice is resumed outside the command handler, allowing authoring to dispatch its own commands. */
export async function resumeProductCampaign(
  deps: ProductServiceDeps,
  id: ProductCampaignId,
  signal: AbortSignal,
): AsyncResult<ProductCampaign> {
  const now = deps.now ?? Date.now;
  const reserved = await deps.store.getCampaign(id);
  if (!reserved.ok) return reserved;
  const campaign = reserved.value;
  if (campaign.status !== 'draft' || campaign.conversationId) return ok(campaign);
  const product = await deps.store.get(campaign.productId);
  if (!product.ok) return product;
  if (product.value.archivedAt !== null) return err(ProductArchived());
  const found = await deps.store.getIdea(campaign.ideaId);
  if (!found.ok) return found;
  const idea = found.value;
  const knowledge = await deps.store.knowledge(campaign.productId);
  if (!knowledge.ok) return knowledge;
  const evidence = await deps.store.knowledgeByIds(
    campaign.productId,
    idea.evidence.map((item) => item.knowledgeId),
  );
  if (!evidence.ok) return evidence;
  if (
    !idea.evidence.every((item) =>
      evidence.value.some((doc) => doc.id === item.knowledgeId && doc.digest === item.digest),
    )
  )
    return err(ProductEvidenceChanged());
  const context = [...new Map([...evidence.value, ...knowledge.value].map((doc) => [doc.id, doc])).values()];
  const created = await deps.creation.create(
    { product: product.value, idea, campaign, knowledge: context },
    signal,
  );
  if (!created.ok) return created;
  const next: ProductCampaign = {
    ...campaign,
    revision: campaign.revision + 1,
    updatedAt: now(),
    status: 'draft',
    conversationId: created.value.conversationId,
  };
  if (created.value.projectId !== campaign.projectId)
    return err(ProductEvidenceChanged(undefined, { detail: 'Authoring returned a different project' }));
  const saved = await deps.store.saveCampaign(next, campaign.revision);
  if (!saved.ok) return saved;
  return ok(next);
}
