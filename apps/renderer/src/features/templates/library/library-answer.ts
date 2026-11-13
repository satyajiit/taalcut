// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Templates page's one answer (LRN1-FIX). Without words it is templates.list for the view (page after page, 200
 * a page); with words it is templates.search's answer for them in the view's scope, whole, best first. The list, its
 * count and the search panel all read it, so they can't disagree. Length is the window's filter on either answer:
 * neither query takes one, and both answers are whole, so filtering them here is exact.
 */
import {
  TEMPLATE_SEARCH_MAX_HITS,
  type TemplateId,
  type TemplateListQuery,
  type TemplateSearchHit,
  type TemplateSearchResult,
  type TemplateSearchQuery,
  type TemplateSummary,
} from '@taalcut/core';
import { toSeconds } from '@taalcut/ui';
import type { Backend } from '../../../backend/contract';
import { lengthOf, type TemplateLength } from './template-search';

/** At most this many templates in one view; more would need the list's own paging in the window. */
export const MAX_TEMPLATES = 2000;
const PAGE = 200;

type Templates = Pick<Backend['templates'], 'list' | 'search'>;

/** What templates.search found for the words: its hits (the list's rows, one for one) and how it searched. */
export interface LibraryMatches {
  readonly hits: readonly TemplateSearchHit[];
  /** Each hit by its template, for the row that shows it. */
  readonly byId: ReadonlyMap<TemplateId, TemplateSearchHit>;
  /** 'keyword-only' while search reads words only (no Search model yet). */
  readonly degraded: TemplateSearchResult['degraded'];
  readonly fusion: string;
}

export interface LibraryAnswer {
  /** The words it answers: '' for the library without words. */
  readonly words: string;
  /** The view it answers (its words, query and length): the list on screen answers an older one while it settles. */
  readonly view: string;
  /** The templates to list, in order. */
  readonly items: readonly TemplateSummary[];
  /** With words, templates.search's answer, `items` being its hits' templates; null without words. */
  readonly matches: LibraryMatches | null;
}

/** What one answer is asked for. */
export interface LibraryAsk {
  readonly words: string;
  /** templates.list's query for the view, without words (listQueryOf). */
  readonly query: Partial<TemplateListQuery>;
  /** templates.search's scope for the view (searchScopeOf). */
  readonly scope: Partial<TemplateSearchQuery>;
  readonly length: TemplateLength | undefined;
}

/** The key of the view an answer is for: words, query and length. */
export const viewOf = (
  words: string,
  query: Partial<TemplateListQuery>,
  length: TemplateLength | undefined,
) => JSON.stringify([words, query, length ?? null]);

/** Every template the query lists, page after page, up to MAX_TEMPLATES. */
export async function listAll(templates: Templates, query: Partial<TemplateListQuery>, signal: AbortSignal) {
  const items: TemplateSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await templates.list({ ...query, limit: PAGE, ...(cursor ? { cursor } : {}) }, { signal });
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && items.length < MAX_TEMPLATES);
  return items;
}

const ofLength = (length: TemplateLength | undefined) => (summary: TemplateSummary) =>
  !length || lengthOf(toSeconds(summary.duration)) === length;

export async function answerFor(
  templates: Templates,
  ask: LibraryAsk,
  signal: AbortSignal,
): Promise<LibraryAnswer> {
  const view = viewOf(ask.words, ask.query, ask.length);
  const fits = ofLength(ask.length);
  if (!ask.words) {
    const items = (await listAll(templates, ask.query, signal)).filter(fits);
    return { words: '', view, items, matches: null };
  }
  const found = await templates.search(
    { text: ask.words, limit: TEMPLATE_SEARCH_MAX_HITS, ...ask.scope },
    { signal },
  );
  const hits = found.hits.filter((hit) => fits(hit.summary));
  return {
    words: ask.words,
    view,
    items: hits.map((hit) => hit.summary),
    matches: {
      hits,
      byId: new Map(hits.map((hit) => [hit.summary.id, hit])),
      degraded: found.degraded,
      fusion: found.fusion,
    },
  };
}
