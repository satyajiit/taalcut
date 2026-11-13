// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-TPL, LRN1-FIX: templates.search over the fake's templates, as the library's TemplateSearch answers it, so the
 * Templates page's e2e proves the page shows one answer.
 *
 * - Words (template-terms.ts): any of the query's terms, stopwords dropped, a prefix of a token in the name, slot
 *   intents, on-screen words or tags; ranked by the columns that hold them, weighted as the library's bm25 (name 2,
 *   tags 1.5, intents 1, on-screen 0.8), the best 200, in the query's scope.
 * - Meaning (no embedding model here): a small table of related words. A template holding more words related to the
 *   query's is closer; the slot whose intent holds the most is its slot match, named by its place and intent.
 * - Fused by reciprocal rank (words 1, meaning 1, slot 0.8; k 60) as template-search-v1, best first, in the query's
 *   scope (folder, favourites, tags, format, language, trend), at most `limit`.
 *
 * Scenario (`templateSearch` in taalcut.fake, options/template-search.ts): absent, search reads words only
 * (`degraded: 'keyword-only'`, as before the Search model is downloaded); 'ready' searches meaning and slot intents
 * too; 'failing' times out every search.
 */
import {
  TimeoutError,
  toRpcError,
  uniqueBy,
  type Id,
  type Template,
  type TemplateListQuery,
  type TemplateSearchHit,
  type TemplateSearchMatch,
  type TemplateSearchQuery,
  type TemplateSearchResult,
  type TemplateSearchSlot,
  type TemplateSummary,
} from '@taalcut/core';
import type { FakeTemplates } from './fake-templates';
import { allTokens, columnsOf, holds, queryTerms, tokensOf, type TemplateColumns } from './template-terms';

export type FakeTemplateSearchScenario = 'ready' | 'failing';

export const readTemplateSearchScenario = (value: unknown): FakeTemplateSearchScenario | null =>
  value === 'ready' || value === 'failing' ? value : null;

const FUSION = 'template-search-v1';
/** Reciprocal rank fusion's constant and each list's weight (words 1, meaning 1, slot 0.8), as the library's. */
const RRF_K = 60;
const WEIGHTS: Readonly<Record<TemplateSearchMatch, number>> = { words: 1, meaning: 1, slot: 0.8 };
const KINDS: readonly TemplateSearchMatch[] = ['words', 'meaning', 'slot'];
/** Word hits fused, as template-search-v1's `wordLimit`. */
const WORD_LIMIT = 200;
/** The library's bm25 column weights: name, intents, on-screen words, tags. */
const COLUMN_WEIGHTS: Readonly<Record<keyof TemplateColumns, number>> = {
  name: 2,
  intents: 1,
  overlays: 0.8,
  tags: 1.5,
};

/** The fake's "meaning": words that stand for one another. Data, never shown. */
const RELATED: readonly (readonly string[])[] = [
  ['sea', 'ocean', 'beach', 'waves', 'water', 'coast', 'shore'],
  ['coffee', 'breakfast', 'morning', 'café', 'chai', 'sip', 'brew'],
  ['market', 'stall', 'food', 'street', 'bazaar', 'thali'],
  ['sunset', 'golden', 'dusk', 'evening', 'light'],
  ['city', 'skyline', 'lights', 'night', 'fireworks'],
  ['talking', 'camera', 'vlog', 'question', 'answer', 'opener', 'hook'],
  ['work', 'desk', 'laptop', 'typing', 'office'],
].map((group) => group.flatMap(tokensOf));

/** The words related to the query's: every word of each group one of its words is in. */
const relatedTo = (text: string): ReadonlySet<string> => {
  const words = new Set(tokensOf(text));
  return new Set(RELATED.filter((group) => group.some((word) => words.has(word))).flat());
};

/** How many distinct related words `tokens` hold: the fake's closeness. */
const closeness = (related: ReadonlySet<string>, tokens: readonly string[]) =>
  new Set(tokens.filter((token) => related.has(token))).size;

interface Ranked {
  readonly templateId: Id<'Template'>;
  readonly slotId?: Id<'TemplateSlot'>;
  readonly slot?: TemplateSearchSlot;
}

interface Row {
  readonly summary: TemplateSummary;
  readonly template: Template;
  readonly columns: TemplateColumns;
}

/** A row's word score: each term counts once per column that holds it, at the column's weight. */
const wordScore = (row: Row, terms: readonly string[]) =>
  terms.reduce(
    (sum, term) =>
      sum +
      (Object.keys(COLUMN_WEIGHTS) as (keyof TemplateColumns)[]).reduce(
        (score, column) => score + (holds(row.columns[column], term) ? COLUMN_WEIGHTS[column] : 0),
        0,
      ),
    0,
  );

/** Templates by their words: any term a prefix of a token, the best first, at most WORD_LIMIT. */
function byWords(rows: readonly Row[], terms: readonly string[]): Ranked[] {
  if (terms.length === 0) return [];
  return rows
    .map((row) => ({ row, score: wordScore(row, terms) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || (a.row.summary.id < b.row.summary.id ? -1 : 1))
    .slice(0, WORD_LIMIT)
    .map(({ row }) => ({ templateId: row.summary.id }));
}

/** The entries holding any related word, the most first. */
const closest = (entries: readonly { readonly entry: Ranked; readonly shared: number }[]): Ranked[] =>
  entries
    .filter(({ shared }) => shared > 0)
    .sort((a, b) => b.shared - a.shared)
    .map(({ entry }) => entry);

/** Templates by meaning: the most related words first. */
const byMeaning = (rows: readonly Row[], related: ReadonlySet<string>): Ranked[] =>
  closest(
    rows.map((row) => ({
      entry: { templateId: row.summary.id },
      shared: closeness(related, allTokens(row.columns)),
    })),
  );

/** Templates by their best slot: the intent with the most related words, named by its place and intent. */
const bySlot = (rows: readonly Row[], related: ReadonlySet<string>): Ranked[] =>
  closest(
    rows.flatMap(({ summary, template }) =>
      template.slots.map((slot, index) => ({
        entry: { templateId: summary.id, slotId: slot.id, slot: { index, intent: slot.intent.text } },
        shared: closeness(related, tokensOf(slot.intent.text)),
      })),
    ),
  );

/** A template's fused hit, but its summary. */
interface Fused {
  score: number;
  matchedBy: TemplateSearchMatch[];
  slotId: Id<'TemplateSlot'> | null;
  slot?: TemplateSearchSlot;
}

/** The lists fused: each template once, its score the weighted reciprocal ranks over the best possible. */
function fuse(
  lists: Readonly<Partial<Record<TemplateSearchMatch, Ranked[]>>>,
  rows: readonly Row[],
  limit: number,
): TemplateSearchHit[] {
  const searched = KINDS.filter((kind) => lists[kind] !== undefined);
  const best = searched.reduce((sum, kind) => sum + WEIGHTS[kind] / (RRF_K + 1), 0);
  const hits = new Map<string, Fused>();
  for (const kind of searched)
    // Each template once, at its first (best) entry: a template's later slots don't count again.
    uniqueBy(lists[kind] ?? [], (entry) => entry.templateId).forEach((entry, at) => {
      const hit = hits.get(entry.templateId) ?? { score: 0, matchedBy: [], slotId: null };
      hit.score += WEIGHTS[kind] / (RRF_K + at + 1);
      hit.matchedBy.push(kind);
      if (entry.slotId) hit.slotId = entry.slotId;
      if (entry.slot) hit.slot = entry.slot;
      hits.set(entry.templateId, hit);
    });
  const byId = new Map<string, TemplateSummary>(rows.map((row) => [row.summary.id, row.summary]));
  return [...hits.entries()]
    .sort((a, b) => b[1].score - a[1].score || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .flatMap(([id, hit]): TemplateSearchHit[] => {
      const summary = byId.get(id);
      return summary ? [{ summary, ...hit, score: Math.min(1, hit.score / best) }] : [];
    });
}

/** Every template in the scope, page after page. */
async function scoped(templates: FakeTemplates, scope: Partial<TemplateListQuery>): Promise<Row[]> {
  const rows: Row[] = [];
  let cursor: string | undefined;
  do {
    const page = await templates.list({
      includeUnlisted: false,
      includeArchived: false,
      ...scope,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    for (const summary of page.items) {
      const template = templates.template(summary.id);
      if (template)
        rows.push({ summary, template, columns: columnsOf(summary.name, summary.tags, template) });
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return rows;
}

/** templates.search over the fake's templates, in the query's scope, as the scenario says. */
export async function fakeTemplateSearch(
  templates: FakeTemplates,
  query: TemplateSearchQuery,
  scenario: FakeTemplateSearchScenario | null,
): Promise<TemplateSearchResult> {
  if (scenario === 'failing') throw toRpcError(TimeoutError({ ms: 30_000 }));
  const { text, limit, ...scope } = query;
  const rows = await scoped(templates, scope);
  const words = byWords(rows, queryTerms(text));
  if (scenario !== 'ready')
    return { hits: fuse({ words }, rows, limit), degraded: 'keyword-only', fusion: FUSION };
  const related = relatedTo(text);
  const lists = { words, meaning: byMeaning(rows, related), slot: bySlot(rows, related) };
  return { hits: fuse(lists, rows, limit), degraded: null, fusion: FUSION };
}
