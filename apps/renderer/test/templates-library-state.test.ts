// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { FORMAT_IDS, newId, TEMPLATE_SORTS, templateTagSchema, type TemplateId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  extend,
  NO_SELECTION,
  prune,
  selectAll,
  selectedIn,
  toggle,
} from '../src/features/templates/library/selection';
import { nextState, normaliseTag, planTags, tagStates } from '../src/features/templates/library/tag-edits';
import {
  hasFilters,
  isTrendStale,
  lengthOf,
  listQueryOf,
  parseTemplateSearch,
  sortOf,
  TEMPLATE_FORMATS,
  TEMPLATE_SORT_CHOICES,
} from '../src/features/templates/library/template-search';

const FOLDER = '01K7C5M6Q88000000000000001';

describe('the template library URL', () => {
  it('keeps its lists in step with core', () => {
    expect([...TEMPLATE_FORMATS].sort()).toEqual([...FORMAT_IDS].sort());
    expect([...TEMPLATE_SORT_CHOICES].sort()).toEqual([...TEMPLATE_SORTS].sort());
  });

  it('parses every key and drops what it does not know', () => {
    expect(
      parseTemplateSearch({
        q: '  market  ',
        folder: FOLDER,
        tags: 'Food,travel,no spaces!,शादी',
        format: 'vlog',
        lang: 'pt-BR',
        length: 'short',
        stale: 'true',
        sort: 'name',
        dir: 'asc',
      }),
    ).toEqual({
      q: 'market',
      folder: FOLDER,
      tags: 'food,travel,शादी',
      format: 'vlog',
      lang: 'pt-BR',
      length: 'short',
      stale: true,
      sort: 'name',
      dir: 'asc',
    });
    expect(
      parseTemplateSearch({
        folder: 'nope',
        format: 'film',
        lang: '!!',
        length: 'huge',
        stale: 'yes',
        sort: 'size',
        dir: 'up',
      }),
    ).toEqual({
      q: undefined,
      folder: undefined,
      tags: undefined,
      format: undefined,
      lang: undefined,
      length: undefined,
      stale: undefined,
      sort: undefined,
      dir: undefined,
    });
    expect(parseTemplateSearch({ folder: 'favourites' }).folder).toBe('favourites');
    expect(parseTemplateSearch({ tags: ['a', 'b'] }).tags).toBe('a,b');
  });

  it('asks templates.list for the view without its words, recently changed first by default', () => {
    expect(listQueryOf({})).toEqual({ sort: 'updated', dir: 'desc' });
    // The words go to templates.search (search-scope.ts), never to the list's own word filter.
    expect(listQueryOf({ folder: 'favourites', q: 'chai', tags: 'food,beach', stale: true })).toEqual({
      favourite: true,
      tags: ['food', 'beach'],
      stale: true,
      sort: 'updated',
      dir: 'desc',
    });
    expect(listQueryOf({ folder: 'unfiled' }).folderId).toBe('none');
    expect(listQueryOf({ folder: FOLDER as never, format: 'vlog', lang: 'hi' })).toMatchObject({
      folderId: FOLDER,
      formatId: 'vlog',
      language: 'hi',
    });
    // Names A to Z unless the URL says otherwise; length is the window's own filter.
    expect(sortOf({ sort: 'name' })).toEqual({ sort: 'name', dir: 'asc' });
    expect(sortOf({ sort: 'name', dir: 'desc' })).toEqual({ sort: 'name', dir: 'desc' });
    expect(listQueryOf({ length: 'long' })).not.toHaveProperty('length');
    expect(hasFilters({ q: 'x', folder: 'favourites', sort: 'name' })).toBe(false);
    expect(hasFilters({ length: 'short' })).toBe(true);
  });

  it('buckets lengths and dates trends as the service does', () => {
    expect([lengthOf(15), lengthOf(15.1), lengthOf(30), lengthOf(31)]).toEqual([
      'short',
      'medium',
      'medium',
      'long',
    ]);
    const now = Date.UTC(2026, 9, 15);
    expect(isTrendStale('2026-07-17', now)).toBe(false);
    expect(isTrendStale('2026-07-16', now)).toBe(true);
    expect(isTrendStale('not a date', now)).toBe(false);
  });
});

describe('selecting templates', () => {
  const ids = Array.from({ length: 6 }, () => newId<'Template'>());
  const at = (i: number) => ids[i] as TemplateId;

  it('toggles, extends a run from the anchor, takes all and lets go of what leaves the view', () => {
    let selection = toggle(NO_SELECTION, at(1));
    selection = extend(selection, ids, at(3));
    expect(selectedIn(selection, ids)).toEqual([at(1), at(2), at(3)]);
    selection = toggle(selection, at(2));
    expect(selectedIn(selection, ids)).toEqual([at(1), at(3)]);
    expect(selectAll(ids).ids.size).toBe(6);
    const pruned = prune(selection, [at(0), at(1)]);
    expect(selectedIn(pruned, ids)).toEqual([at(1)]);
    expect(prune(pruned, ids)).toBe(pruned);
    // Extending with no anchor starts at the row itself.
    expect(selectedIn(extend(NO_SELECTION, ids, at(4)), ids)).toEqual([at(4)]);
  });
});

describe('tagging one template or many', () => {
  const a = { id: newId<'Template'>(), tags: ['food', 'beach'] };
  const b = { id: newId<'Template'>(), tags: ['food'] };

  it('normalises like core, so a tag the dialog accepts is one the command takes', () => {
    for (const raw of ['Golden Hour', '  शादी ', 'Día-de-playa', 'a'.repeat(32)]) {
      const tag = normaliseTag(raw);
      expect(tag).toBe(templateTagSchema.parse(raw));
    }
    expect(normaliseTag('no spaces!')).toBeNull();
    expect(normaliseTag('a'.repeat(33))).toBeNull();
  });

  it('marks tags on all or some, and plans one setTags per template that changes', () => {
    const states = tagStates([a, b]);
    expect([...states]).toEqual([
      ['food', 'on'],
      ['beach', 'mixed'],
    ]);
    expect(nextState('mixed')).toBe('on');
    // Some keep "beach" as they are; a new tag goes on both; "food" comes off both.
    const plan = planTags([a, b], new Map([...states, ['travel', 'on'], ['food', 'off']]));
    expect(plan).toEqual({
      ok: true,
      steps: [
        { templateId: a.id, tags: ['beach', 'travel'] },
        { templateId: b.id, tags: ['travel'] },
      ],
    });
    expect(planTags([a, b], states)).toEqual({ ok: true, steps: [] });
    const many = new Map(Array.from({ length: 12 }, (_, i) => [`tag-${i}`, 'on' as const]));
    expect(planTags([a], many)).toEqual({ ok: false, tooMany: 14 });
  });
});
