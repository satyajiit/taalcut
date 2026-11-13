// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `templates.search` (LRN1-TPL): registered only where the library's template search is, asks it for listed,
 * unarchived templates, hands back each hit with what matched it, and marks the template's name as the user's text
 * for the model. The search itself is the library's (packages/library/test/stores/template-search.test.ts).
 */
import {
  err,
  NotFoundError,
  ok,
  toolModuleProblems,
  type AsyncResult,
  type TemplateId,
  type TemplateSearch,
  type TemplateSearchQuery,
  type TemplateSearchResult,
} from '@taalcut/core';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { setupTools, type ToolSetup } from './helpers/tool-setup';

let setup: ToolSetup | undefined;
afterEach(() => setup?.cleanup());

function fakeSearch(answer: (query: TemplateSearchQuery) => AsyncResult<TemplateSearchResult>) {
  const queries: TemplateSearchQuery[] = [];
  const search: TemplateSearch = {
    search(query) {
      queries.push(query);
      return answer(query);
    },
  };
  return { search, queries };
}

async function plannedSummary(s: ToolSetup) {
  const planned = await s.value<{ templateId: string }>('templates.planFromFormat', {
    projectId: s.projectA,
    formatId: 'vlog',
    targetSeconds: 30,
  });
  const got = await s.service.get({ templateId: planned.templateId as TemplateId });
  if (!got.ok) throw new Error(got.error.code);
  return got.value;
}

describe('templates.search', () => {
  it('declares full metadata and converts to JSON Schema', () => {
    setup = setupTools({
      search: fakeSearch(async () => ok({ hits: [], degraded: null, fusion: 'x' })).search,
    });
    const tool = setup.tool('templates.search');
    expect(toolModuleProblems({ id: 'templates', tools: [tool] })).toEqual([]);
    expect([tool.sideEffect, tool.costClass]).toEqual(['read', 'local']);
    expect(tool.idempotencyKey?.(tool.input.parse({ text: 'coffee' }))).toMatch(
      /^templates\.search:[0-9a-f]{64}$/,
    );
  });

  it('is not registered without a template search', () => {
    setup = setupTools();
    expect(setup.module.tools.map((tool) => tool.name)).not.toContain('templates.search');
  });

  it('asks for listed, unarchived templates and returns each hit with what matched it', async () => {
    let result: TemplateSearchResult = { hits: [], degraded: null, fusion: 'test' };
    const fake = fakeSearch(async () => ok(result));
    setup = setupTools({ search: fake.search });
    const { summary, template } = await plannedSummary(setup);
    const slotId = template.slots[1]?.id ?? null;
    result = {
      hits: [{ summary, score: 0.8, matchedBy: ['meaning', 'slot'], slotId }],
      degraded: null,
      fusion: 'template-search-v1',
    };

    const found = await setup.value<{
      hits: { id: string; name: string; score: number; matchedBy: string[]; slotId: string | null }[];
      degraded: string | null;
      fusion: string;
    }>('templates.search', { text: '  a calm morning routine ' });

    expect(fake.queries).toEqual([
      { text: 'a calm morning routine', includeUnlisted: false, includeArchived: false, limit: 10 },
    ]);
    expect(found).toEqual({
      hits: [
        expect.objectContaining({
          id: summary.id,
          name: summary.name,
          score: 0.8,
          matchedBy: ['meaning', 'slot'],
          slotId,
        }),
      ],
      degraded: null,
      fusion: 'template-search-v1',
    });
  });

  it('passes the filters and says when it searched by words alone', async () => {
    const fake = fakeSearch(async () =>
      ok({ hits: [], degraded: 'keyword-only', fusion: 'template-search-v1' }),
    );
    setup = setupTools({ search: fake.search });
    const found = await setup.value<{ degraded: string | null }>('templates.search', {
      text: 'tutorial',
      includeUnlisted: true,
      formatId: 'tutorial',
      origin: 'format',
      limit: 3,
    });
    expect(found.degraded).toBe('keyword-only');
    expect(fake.queries[0]).toEqual({
      text: 'tutorial',
      includeUnlisted: true,
      includeArchived: false,
      limit: 3,
      formatId: 'tutorial',
      origin: 'format',
    });
  });

  it("returns the search's error as it is", async () => {
    const fake = fakeSearch(async () => err(NotFoundError({ entity: 'index', id: 'tpl' })));
    setup = setupTools({ search: fake.search });
    const result = await setup.call('templates.search', { text: 'coffee' });
    expect(result.ok ? null : result.error.code).toBe('core.not_found');
  });

  it("marks the template's name as the user's text for the model", () => {
    setup = setupTools({
      search: fakeSearch(async () => ok({ hits: [], degraded: null, fusion: 'x' })).search,
    });
    const schema = z.toJSONSchema(setup.tool('templates.search').output, { io: 'output' });
    const hit = (schema.properties?.hits as { items: { properties: Record<string, { untrusted?: string }> } })
      .items;
    expect(hit.properties.name?.untrusted).toBe('user-text');
  });
});
