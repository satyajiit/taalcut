// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  FIT_WEAK_REASONS,
  fitTemplatesInputSchema,
  fitTemplatesResultSchema,
  newId,
  parseTemplateVectorId,
  TEMPLATE_SEARCH_MAX_HITS,
  templateIndexName,
  appContract,
  templateSearchHitSchema,
  templateSearchQuerySchema,
  templateSearchResultSchema,
  templateVectorId,
  timelinesContract,
} from '../src';

const digest = '0123456789abcdef';

describe('LRN1-TPL contract', () => {
  it('names template-index vectors by content and parses them back', () => {
    const templateId = newId<'Template'>();
    const slotId = newId<'TemplateSlot'>();
    const doc = { kind: 'template' as const, templateId, digest };
    const intent = { kind: 'intent' as const, templateId, slotId, digest };
    expect(parseTemplateVectorId(templateVectorId(doc))).toEqual(doc);
    expect(parseTemplateVectorId(templateVectorId(intent))).toEqual(intent);
    expect(templateIndexName('eg2_q4_daa72c5')).toBe('eg2_q4_daa72c5_tpl');
  });

  it('parses anything else to null', () => {
    const templateId = newId<'Template'>();
    const slotId = newId<'TemplateSlot'>();
    for (const id of [
      `frame:${templateId}:${digest}`,
      `template:not-a-ulid:${digest}`,
      `template:${templateId}:0123`,
      `template:${templateId}:0123456789ABCDEF`,
      `template:${templateId}:${slotId}:${digest}`,
      `intent:${templateId}:${digest}`,
      `intent:${templateId}:nope:${digest}`,
      `intent:${templateId}:${slotId}:${digest}:extra`,
    ])
      expect(parseTemplateVectorId(id)).toBeNull();
  });

  it('applies the search defaults and refuses empty text', () => {
    expect(templateSearchQuerySchema.parse({ text: ' hook ' })).toMatchObject({ text: 'hook', limit: 10 });
    expect(templateSearchQuerySchema.safeParse({ text: '   ' }).success).toBe(false);
    const summaryLess = { score: 0.5, matchedBy: [], slotId: null };
    expect(templateSearchHitSchema.safeParse(summaryLess).success).toBe(false);
  });

  it('serves template search over IPC with what matched each hit', () => {
    expect(appContract.templates.search).toBeDefined();
    const summaryLess = { score: 0.5, matchedBy: ['words'], slotId: null };
    const result = { hits: [], degraded: 'keyword-only', fusion: 'template-search-v1' };
    expect(templateSearchResultSchema.parse(result)).toEqual(result);
    expect(templateSearchHitSchema.safeParse({ ...summaryLess, matchedBy: [] }).success).toBe(false);
    for (const match of ['words', 'meaning', 'slot'])
      expect(templateSearchHitSchema.shape.matchedBy.safeParse([match]).success).toBe(true);
  });

  it('takes the trend filter, returns a whole answer, and names a matched slot by its place', () => {
    expect(templateSearchQuerySchema.parse({ text: 'hook', stale: true })).toMatchObject({ stale: true });
    expect(templateSearchQuerySchema.parse({ text: 'hook', limit: TEMPLATE_SEARCH_MAX_HITS }).limit).toBe(
      TEMPLATE_SEARCH_MAX_HITS,
    );
    expect(
      templateSearchQuerySchema.safeParse({ text: 'hook', limit: TEMPLATE_SEARCH_MAX_HITS + 1 }).success,
    ).toBe(false);
    const slot = { index: 2, intent: 'Close-up of the hook, text on screen' };
    expect(templateSearchHitSchema.shape.slot.parse(slot)).toEqual(slot);
    expect(templateSearchHitSchema.shape.slot.safeParse({ index: -1, intent: '' }).success).toBe(false);
    expect(templateSearchResultSchema.shape.hits.safeParse([]).success).toBe(true);
  });

  it('needs a bound on the pool and defaults the scope and limit', () => {
    expect(fitTemplatesInputSchema.safeParse({ pool: {} }).success).toBe(false);
    const sourceId = newId<'Source'>();
    expect(fitTemplatesInputSchema.parse({ pool: { sourceIds: [sourceId] } })).toEqual({
      pool: { sourceIds: [sourceId] },
      templates: {},
      limit: 10,
    });
    expect(FIT_WEAK_REASONS).toEqual(['noShot', 'orientation', 'taken']);
    const empty = { configVersion: 'casting.v1', poolShots: 0, poolTruncated: false, templates: 0, fits: [] };
    expect(fitTemplatesResultSchema.parse(empty)).toEqual(empty);
    expect(timelinesContract.fitTemplates).toBeDefined();
  });
});
