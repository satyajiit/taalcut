// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, type ProductIdea, type ProductKnowledge } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { productResearchContext } from '../src/utility/products/model';

describe('product research context', () => {
  it('bounds large source and history collections while retaining evidence identifiers', () => {
    const knowledge: ProductKnowledge[] = Array.from({ length: 2000 }, () => ({
      id: newId<'ProductKnowledge'>(),
      productId: newId<'Product'>(),
      sourceId: newId<'CreationSource'>(),
      locator: 'README.md',
      title: 'Product evidence',
      digest: 'sha256',
      text: 'x'.repeat(24_000),
      capturedAt: 1,
    }));
    const history: ProductIdea[] = Array.from({ length: 1000 }, () => ({
      id: newId<'ProductIdea'>(),
      productId: newId<'Product'>(),
      title: 'Old idea',
      featureKey: 'feature',
      angle: 'a'.repeat(1000),
      hook: 'hook',
      rationale: 'rationale',
      score: 0.9,
      evidence: [],
      status: 'rejected',
      feedback: 'f'.repeat(2000),
      createdAt: 1,
      updatedAt: 1,
    }));
    const context = productResearchContext(knowledge, history, 60_000);
    expect(JSON.stringify(context).length).toBeLessThan(60_000);
    expect(context.evidence[0]?.id).toBe(knowledge[0]!.id);
    expect(context.previousIdeas.length).toBeGreaterThan(0);
    expect(context.previousIdeas.length).toBeLessThan(1000);
    expect(knowledge[0]!.text).toHaveLength(24_000);
  });
  it('preserves late coverage notices and measures serialized escaping inside small windows', () => {
    const document: ProductKnowledge = {
      id: newId<'ProductKnowledge'>(),
      productId: newId<'Product'>(),
      sourceId: newId<'CreationSource'>(),
      locator: 'first.md',
      title: 'Long evidence',
      digest: 'hash',
      text: '"\\\n'.repeat(8000),
      capturedAt: 1,
    };
    const coverage = {
      ...document,
      id: newId<'ProductKnowledge'>(),
      locator: 'taalcut:index-coverage',
      text: 'This source index is bounded. Missing evidence is not an absent feature.',
    };
    const context = productResearchContext([document, coverage], [], 2000);
    expect(context.evidence[0]!.id).toBe(coverage.id);
    expect(context.evidenceSelection.includedCoverageNotices).toBe(1);
    expect(context.evidenceSelection.note).toContain('not a complete source inventory');
    expect(JSON.stringify(context).length).toBeLessThan(2000);
  });
});
