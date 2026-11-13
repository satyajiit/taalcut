// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  CancelledError,
  err,
  newId,
  ok,
  type AsyncResult,
  type Product,
  type ProductIdea,
  type ProductKnowledge,
  type ProductOccurrence,
} from '@taalcut/core';
import { ProductArchived, ProductEvidenceChanged, ProductNoEvidence } from './errors';
import { shortlistProductIdeas } from './novelty';
import type { ProductServiceDeps } from './ports';

export async function researchProduct(
  deps: ProductServiceDeps,
  product: Product,
  signal: AbortSignal,
  occurrenceId?: ProductOccurrence['id'],
): AsyncResult<ProductIdea[]> {
  const now = deps.now ?? Date.now;
  const revision = product.revision;
  if (product.archivedAt !== null) return err(ProductArchived());
  for (const source of product.sources) {
    if (signal.aborted) return err(CancelledError());
    const inspected = await deps.sources.inspect(product, source, signal);
    if (!inspected.ok) return inspected;
    const items = inspected.value.map((item) => ({
      ...item,
      id: newId<'ProductKnowledge'>(),
      productId: product.id,
    }));
    const saved = await deps.store.replaceKnowledge(product.id, source.id, items);
    if (!saved.ok) return saved;
  }
  const current = await deps.store.get(product.id);
  if (!current.ok) return current;
  if (current.value.revision !== revision) return err(ProductEvidenceChanged());
  const preferenceQuery = [
    ...product.preferences.topics,
    product.preferences.audience,
    product.preferences.instructions,
  ]
    .join(' ')
    .trim()
    .slice(0, 500);
  let knowledge = await deps.store.knowledge(product.id, preferenceQuery || undefined);
  if (
    knowledge.ok &&
    preferenceQuery &&
    knowledge.value.every((item) => item.locator === 'taalcut:index-coverage')
  )
    knowledge = await deps.store.knowledge(product.id);
  if (!knowledge.ok) return knowledge;
  if (!knowledge.value.length) return err(ProductNoEvidence());
  const history = await deps.store.ideas(product.id, {
    since: now() - product.preferences.noveltyDays * 86_400_000,
    limit: 1000,
  });
  if (!history.ok) return history;
  const bounded = productPromptKnowledge(knowledge.value);
  const response = await deps.model.shortlist(
    { product, knowledge: bounded, history: history.value },
    signal,
  );
  if (!response.ok) return response;
  if (signal.aborted) return err(CancelledError());
  const latest = await deps.store.get(product.id);
  if (!latest.ok) return latest;
  if (latest.value.revision !== revision) return err(ProductEvidenceChanged());
  const ranked = shortlistProductIdeas(response.value, bounded, history.value);
  const candidates: typeof ranked = [];
  for (const candidate of ranked) {
    const repeated = await deps.store.hasRecentFeature(
      product.id,
      candidate.featureKey,
      now() - product.preferences.noveltyDays * 86_400_000,
      {
        angle: candidate.angle,
        digests: candidate.knowledgeIds.map((id) => bounded.find((doc) => doc.id === id)!.digest),
      },
    );
    if (!repeated.ok) return repeated;
    if (!repeated.value) candidates.push(candidate);
  }
  if (!candidates.length) {
    if (occurrenceId) {
      const checkpoint = await deps.store.saveIdeas([], occurrenceId);
      if (!checkpoint.ok) return checkpoint;
    }
    const noted = await deps.store.appendNotification({
      id: newId<'ProductNotification'>(),
      productId: product.id,
      campaignId: null,
      kind: 'no-fresh-ideas',
      title: product.name,
      body: product.name,
      createdAt: now(),
      readAt: null,
    });
    return noted.ok ? ok([]) : noted;
  }
  const at = now();
  const ideas: ProductIdea[] = candidates.map(({ knowledgeIds, ...idea }) => ({
    ...idea,
    id: newId<'ProductIdea'>(),
    productId: product.id,
    status: 'suggested',
    feedback: null,
    createdAt: at,
    updatedAt: at,
    evidence: knowledgeIds.map((id) => {
      const item = bounded.find((entry) => entry.id === id)!;
      return {
        knowledgeId: item.id,
        sourceId: item.sourceId,
        locator: item.locator,
        digest: item.digest,
        excerpt: item.text.slice(0, 2000),
      };
    }),
  }));
  const saved = await deps.store.saveIdeas(ideas, occurrenceId);
  if (!saved.ok) return saved;
  const notified = await deps.store.appendNotification({
    id: newId<'ProductNotification'>(),
    productId: product.id,
    campaignId: null,
    kind: 'ideas-ready',
    title: product.name,
    body: ideas[0]!.title,
    createdAt: at,
    readAt: null,
  });
  return notified.ok ? ok(ideas) : notified;
}

export function productPromptKnowledge(items: readonly ProductKnowledge[]): ProductKnowledge[] {
  let remaining = 60_000;
  const result: ProductKnowledge[] = [];
  const coverage = items.filter((item) => item.locator === 'taalcut:index-coverage');
  const evidence = items.filter((item) => item.locator !== 'taalcut:index-coverage');
  for (const item of [...coverage, ...evidence]) {
    if (remaining <= 0) break;
    const limit = item.locator === 'taalcut:index-coverage' ? 1000 : 4000;
    const text = item.text.slice(0, Math.min(limit, remaining));
    remaining -= text.length;
    result.push({ ...item, text });
  }
  return result;
}
