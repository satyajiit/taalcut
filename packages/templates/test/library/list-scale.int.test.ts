// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Memory-store list filters and sorts over 200 templates stay under 50 ms (P3-V14). Not SQLite.
 * The gate is the fastest of five samples: a full `pnpm test` runs every package at once, and one
 * wall-clock reading includes time this process was not running.
 */
import { describe, expect, it } from 'vitest';
import { newId, templateListQuerySchema, type Template, type TemplateListQuery } from '@taalcut/core';
import { requirePlan } from '../formats/helpers';
import { referenceTemplate } from '../helpers/fixtures';
import { setupTemplates } from '../helpers/setup';

function copy(
  base: Template,
  id: Template['id'],
  origin: Template['origin'],
  language: Template['language'],
): Template {
  return { ...structuredClone(base), id, origin, language };
}

describe('template list scale', () => {
  it('filters and sorts 200 templates, each query under 50 ms', async () => {
    const { store, clock } = setupTemplates();
    const formatBase = requirePlan('vlog', 30);
    const reference = referenceTemplate();
    const folderId = newId<'TemplateFolder'>();
    const ids: Template['id'][] = [];
    for (let index = 0; index < 200; index += 1) {
      clock.advance(10);
      const id = newId<'Template'>();
      ids.push(id);
      const origin: Template['origin'] =
        index < 20 ? reference.origin : index < 40 ? { kind: 'manual' } : formatBase.origin;
      const language = index % 5 === 0 ? 'hi' : 'en';
      const template = copy(index < 20 ? reference : formatBase, id, origin, language);
      const created = await store.create(template, {
        name: `Reel ${String(index).padStart(3, '0')}`,
        projectId: null,
        listed: index % 11 !== 0,
        trendFreshness:
          index < 15
            ? { date: '2020-01-01', source: 'user' }
            : index < 25
              ? { date: '2025-10-01', source: 'user' }
              : null,
      });
      expect(created.ok).toBe(true);
      if (index % 4 === 0) await store.setMeta(id, { tags: index % 8 === 0 ? ['mehndi'] : ['wedding'] });
      if (index % 3 === 0) await store.setMeta(id, { folderId });
      if (index % 6 === 0) await store.setMeta(id, { favourite: true });
      store.setUsage(id, index);
    }
    const all = { includeUnlisted: true, includeArchived: true, limit: 200 };
    const parse = (query: Parameters<typeof templateListQuerySchema.parse>[0]): TemplateListQuery =>
      templateListQuerySchema.parse(query);

    // The first localeCompare in a process loads collation data. That cost is not a query.
    expect('Reel'.localeCompare('Reel')).toBe(0);
    await store.list(parse(all));
    async function timed(query: TemplateListQuery) {
      let best = Number.POSITIVE_INFINITY;
      let page = await store.list(query);
      for (let sample = 0; sample < 5; sample += 1) {
        const start = performance.now();
        page = await store.list(query);
        const elapsed = performance.now() - start;
        if (elapsed < best) best = elapsed;
      }
      expect(best).toBeLessThan(50);
      expect(page.ok).toBe(true);
      if (!page.ok) throw new Error(page.error.code);
      return page.value.items;
    }

    const everything = await timed(parse(all));
    expect(everything).toHaveLength(200);
    expect(everything[0]?.id).toBe(ids[199]);
    expect(await timed(parse({ ...all, tags: ['mehndi'] }))).toHaveLength(25);
    expect((await timed(parse({ ...all, query: 'mehndi' }))).length).toBeGreaterThan(0);
    expect(await timed(parse({ ...all, folderId }))).toHaveLength(67);
    expect(await timed(parse({ ...all, folderId: 'none' }))).toHaveLength(133);
    expect(await timed(parse({ ...all, favourite: true }))).toHaveLength(34);
    expect(await timed(parse({ ...all, formatId: 'vlog' }))).toHaveLength(160);
    expect(await timed(parse({ ...all, language: 'hi' }))).toHaveLength(40);
    expect(await timed(parse({ ...all, origin: 'reference' }))).toHaveLength(20);
    expect(await timed(parse({ ...all, origin: 'manual' }))).toHaveLength(20);
    expect(await timed(parse({ ...all, origin: 'format' }))).toHaveLength(160);
    expect(await timed(parse({ ...all, stale: true }))).toHaveLength(15);
    const fresh = await timed(parse({ ...all, stale: false }));
    expect(fresh).toHaveLength(185);

    const byName = await timed(parse({ ...all, sort: 'name', dir: 'asc' }));
    expect(byName.map((item) => item.name)).toEqual(
      [...byName.map((item) => item.name)].sort((a, b) => a.localeCompare(b)),
    );
    const byUpdated = await timed(parse({ ...all, sort: 'updated', dir: 'desc' }));
    for (let index = 1; index < byUpdated.length; index += 1) {
      expect(byUpdated[index]?.updatedAt ?? 0).toBeLessThanOrEqual(byUpdated[index - 1]?.updatedAt ?? 0);
    }
    const byTrend = await timed(parse({ ...all, sort: 'trend', dir: 'asc' }));
    expect(byTrend.at(-1)?.trendFreshness).toBeNull();
    expect(byTrend[0]?.trendFreshness?.date).toBe('2020-01-01');
    const byFavourite = await timed(parse({ ...all, sort: 'favourite', dir: 'desc' }));
    expect(byFavourite[0]?.favourite).toBe(true);
    expect(byFavourite.at(-1)?.favourite).toBe(false);
    const byUsed = await timed(parse({ ...all, sort: 'used', dir: 'desc' }));
    expect(byUsed[0]?.id).toBe(ids[199]);
    const page = await timed(parse({ ...all, limit: 1 }));
    expect(page).toHaveLength(1);
  });
});
