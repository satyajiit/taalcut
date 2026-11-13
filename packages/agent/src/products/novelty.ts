// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  productIdeaDraftSchema,
  normalizeProductFeatureKey,
  similarProductAngle,
  type ProductIdea,
  type ProductIdeaDraft,
  type ProductKnowledge,
} from '@taalcut/core';

export function productFeatureKey(text: string): string {
  return normalizeProductFeatureKey(text);
}
export function repeatedProductIdea(
  candidate: Pick<ProductIdeaDraft, 'featureKey' | 'angle'>,
  previous: Pick<ProductIdea, 'featureKey' | 'angle'>,
): boolean {
  if (productFeatureKey(candidate.featureKey) !== productFeatureKey(previous.featureKey)) return false;
  return similarProductAngle(candidate.angle, previous.angle);
}

/** Evidence membership is checked locally; source text never becomes an instruction. */
export function shortlistProductIdeas(
  candidates: readonly ProductIdeaDraft[],
  knowledge: readonly ProductKnowledge[],
  history: readonly ProductIdea[],
): ProductIdeaDraft[] {
  const known = new Set(knowledge.map((item) => item.id));
  const accepted: ProductIdeaDraft[] = [];
  for (const value of [...candidates].sort((a, b) => b.score - a.score)) {
    const parsed = productIdeaDraftSchema.safeParse(value);
    if (!parsed.success || parsed.data.score < 0.6 || parsed.data.knowledgeIds.some((id) => !known.has(id)))
      continue;
    const candidate = parsed.data;
    if (accepted.some((previous) => repeatedProductIdea(candidate, previous))) continue;
    const digests = candidate.knowledgeIds.map((id) => knowledge.find((doc) => doc.id === id)!.digest);
    if (
      history.some(
        (previous) =>
          repeatedProductIdea(candidate, previous) &&
          digests.every((digest) => previous.evidence.some((e) => e.digest === digest)),
      )
    )
      continue;
    accepted.push(candidate);
    if (accepted.length === 5) break;
  }
  return accepted;
}
