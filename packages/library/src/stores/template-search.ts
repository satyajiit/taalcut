// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Template search by meaning (LRN1-TPL; core's TemplateSearch). Three ranked lists, fused by weighted reciprocal
 * rank:
 *
 * - words: `template_fts` (name, slot intents, overlay text, tags), every query term a quoted prefix, OR-ed, ranked
 *   by bm25 with the name and tags weighted up, among the templates the query's filters keep;
 * - meaning: the template index's document vectors (kind `template`), nearest to the query embedded with the query
 *   purpose;
 * - slot: its slot-intent vectors (kind `intent`), each template ranked by its nearest slot, which the hit names.
 *
 * A vector list holds every template the kNN returned, which in a small library is all of them, near or far; as in
 * library search (search-fusion-v2's floors), an entry counts only when its similarity clears the list's floor,
 * measured in one embedding space and applied only there.
 *
 * The list filters (listing, archive, project, tags, folder, favourite, format, language, origin, trend) apply in
 * SQL, as `list` applies them, before the limit: the words list is read within them (so a folder's matches are never
 * crowded out by the rest of the library's), and the vector lists' templates are kept to them. A hit with a slot
 * match carries the slot's place and intent from its head (LRN1-FIX), so a row can say "slot 3's intent: …" without
 * a read. Without an embedder or a template index (no space open yet), or when embedding the query fails, it answers
 * from the words alone and says so (`degraded: 'keyword-only'`). The user's text never reaches FTS5 syntax unquoted.
 */
import {
  ok,
  parseTemplateVectorId,
  searchTerms,
  STALE_AFTER_DAYS_SETTING,
  templateIndexName,
  type AsyncResult,
  type Embedder,
  type SlotId,
  type TemplateId,
  type TemplateSearch,
  type TemplateSearchHit,
  type TemplateSearchMatch,
  type TemplateSearchResult,
  type TemplateSearchSlot,
  type VectorIndex,
} from '@taalcut/core';
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { templates, templateVersions } from '../schema/templates';
import { storedSetting } from './stored-setting';
import { listFilters } from './template-list-filters';
import { selectTemplateRows, summaryOfRow } from './template-list';

/** The fusion as versioned config: reported with eval numbers; bump the version with any change. */
export interface TemplateSearchFusion {
  readonly version: string;
  /** Reciprocal rank's k. */
  readonly k: number;
  readonly weights: Readonly<Record<TemplateSearchMatch, number>>;
  /** Neighbours each vector list reads (the slot list reads this many slots). */
  readonly knn: number;
  /** Word hits fused. */
  readonly wordLimit: number;
  /** Cosine similarity a vector entry needs to count, measured in `space` (an embedding space's index name). */
  readonly floors?: {
    readonly space: string;
    readonly similarity: Partial<Record<'meaning' | 'slot', number>>;
  };
}

/**
 * An untuned prior: words and meaning weigh the same, a single slot a little less. The floors are search-fusion-v2's
 * text floor in EmbeddingGemma 2's space (0.71: a query is closer to its text than to 99 % of the text it isn't
 * about), borrowed for template documents and intents until tools/evals' template-search suite has real labels.
 */
export const TEMPLATE_SEARCH_V1: TemplateSearchFusion = {
  version: 'template-search-v1',
  k: 60,
  weights: { words: 1, meaning: 1, slot: 0.8 },
  knn: 400,
  wordLimit: 200,
  floors: { space: 'eg2_q4_daa72c5', similarity: { meaning: 0.71, slot: 0.71 } },
};

/** name, intents, overlays, tags (template_id is unindexed). */
const BM25 = 'bm25(template_fts, 0, 2.0, 1.0, 0.8, 1.5)';

export interface TemplateSearchDeps {
  readonly db: LibraryDatabase;
  /** The active space's template index (TemplateIndexToken); null before one is open. */
  readonly vectors: VectorIndex | null;
  /** Core's Embedder in the same space; null while the model isn't installed. */
  readonly embedder: Embedder | null;
  readonly fusion?: TemplateSearchFusion;
}

interface Ranked {
  readonly templateId: string;
  readonly slotId?: SlotId;
}

/** Template ids by bm25, best first, among `scope` (the ids the query's filters keep). */
export function wordList(
  db: LibraryDatabase,
  text: string,
  limit: number,
  scope: readonly string[],
): Ranked[] {
  const terms = searchTerms(text);
  if (terms.length === 0 || scope.length === 0) return [];
  const match = terms.map((term) => `"${term.replace(/"/g, '""')}"*`).join(' OR ');
  return db.driver
    .prepare(
      `SELECT template_id FROM template_fts WHERE template_fts MATCH ?
         AND template_id IN (SELECT value FROM json_each(?)) ORDER BY ${BM25} LIMIT ?`,
    )
    .all(match, JSON.stringify(scope), limit)
    .map((row) => ({ templateId: String(row.template_id) }));
}

/** Each template once, at the rank of its nearest vector of `kind` that clears the floor. */
function vectorList(
  index: VectorIndex,
  query: Float32Array,
  kind: 'template' | 'intent',
  knn: number,
  floor = -1,
) {
  const k = Math.max(1, Math.min(knn, 4096));
  const found = index.search(query, { k, filter: { kind } });
  if (!found.ok) return found;
  // Unit vectors: an L2 index's |a − b|² is 2 − 2·cos.
  const similarity = (distance: number) =>
    index.metric === 'cosine' ? 1 - distance : 1 - (distance * distance) / 2;
  const seen = new Set<string>();
  const ranked: Ranked[] = [];
  for (const match of found.value) {
    const key = parseTemplateVectorId(match.id);
    if (!key || seen.has(key.templateId) || similarity(match.distance) < floor) continue;
    seen.add(key.templateId);
    ranked.push(key.kind === 'intent' ? { templateId: key.templateId, slotId: key.slotId } : key);
  }
  return ok(ranked);
}

type Lists = Partial<Record<TemplateSearchMatch, readonly Ranked[]>>;

/** The meaning and slot lists, or null when the query can't be embedded here. */
async function meaningLists(
  deps: TemplateSearchDeps,
  text: string,
  fusion: TemplateSearchFusion,
  signal?: AbortSignal,
) {
  const { vectors, embedder } = deps;
  if (!vectors || !embedder) return ok(null);
  const embedded = await embedder.embedTexts([text], { purpose: 'query', ...(signal ? { signal } : {}) });
  const query = embedded.ok ? embedded.value[0] : undefined;
  if (!query) return ok(null);
  const floors =
    fusion.floors && vectors.name === templateIndexName(fusion.floors.space) ? fusion.floors.similarity : {};
  const meaning = vectorList(vectors, query, 'template', fusion.knn, floors.meaning);
  if (!meaning.ok) return meaning;
  const slot = vectorList(vectors, query, 'intent', fusion.knn, floors.slot);
  return slot.ok ? ok<Lists>({ meaning: meaning.value, slot: slot.value }) : slot;
}

interface Fused {
  readonly templateId: string;
  readonly score: number;
  readonly matchedBy: TemplateSearchMatch[];
  readonly slotId: SlotId | null;
}

function fuse(lists: Lists, fusion: TemplateSearchFusion): Fused[] {
  const order = ['words', 'meaning', 'slot'] as const;
  const possible = order.filter((list) => lists[list] !== undefined);
  const max = possible.reduce((sum, list) => sum + fusion.weights[list] / (fusion.k + 1), 0);
  const byId = new Map<string, { score: number; matchedBy: TemplateSearchMatch[]; slotId: SlotId | null }>();
  for (const list of order) {
    (lists[list] ?? []).forEach((entry, rank) => {
      const hit = byId.get(entry.templateId) ?? { score: 0, matchedBy: [], slotId: null };
      hit.score += fusion.weights[list] / (fusion.k + rank + 1);
      hit.matchedBy.push(list);
      if (entry.slotId) hit.slotId = entry.slotId;
      byId.set(entry.templateId, hit);
    });
  }
  return [...byId]
    .map(([templateId, hit]) => ({ templateId, ...hit, score: max > 0 ? Math.min(1, hit.score / max) : 0 }))
    .sort((a, b) => b.score - a.score || (a.templateId < b.templateId ? -1 : 1));
}

/** The ids of the templates `where` keeps (each lineage joined with its head, as `list` reads it). */
function idsWhere(db: LibraryDatabase, where: SQL | undefined): string[] {
  return db.orm
    .select({ id: templates.id })
    .from(templates)
    .innerJoin(
      templateVersions,
      and(eq(templateVersions.templateId, templates.id), eq(templateVersions.version, templates.headVersion)),
    )
    .where(where)
    .all()
    .map((row) => row.id);
}

/** Each slot of these templates' heads by its id: its place (from 0) and its intent as written. */
function headSlots(db: LibraryDatabase, templateIds: readonly string[]): Map<string, TemplateSearchSlot> {
  if (templateIds.length === 0) return new Map();
  const rows = db.driver
    .prepare(
      `SELECT s.key AS place, json_extract(s.value, '$.id') AS slot_id,
              json_extract(s.value, '$.intent.text') AS intent
         FROM templates t
         JOIN template_versions v ON v.template_id = t.id AND v.version = t.head_version,
              json_each(v.document, '$.slots') s
        WHERE t.id IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(templateIds));
  return new Map(
    rows.map((row) => [String(row.slot_id), { index: Number(row.place), intent: String(row.intent ?? '') }]),
  );
}

/** The fused templates in the query's scope, as hits, best first, at most `limit`; a slot match placed in its head. */
function hitsOf(db: LibraryDatabase, scope: ReadonlySet<string>, fused: readonly Fused[], limit: number) {
  const kept = fused.filter((hit) => scope.has(hit.templateId)).slice(0, limit);
  if (kept.length === 0) return [];
  const ids = kept.map((hit) => hit.templateId as TemplateId);
  const rows = selectTemplateRows(db, inArray(templates.id, ids), [], ids.length);
  const summaries = new Map(rows.map((row) => [row.lineage.id as string, summaryOfRow(row)]));
  const slots = headSlots(
    db,
    kept.filter((hit) => hit.slotId).map((hit) => hit.templateId),
  );
  return kept.flatMap((hit): TemplateSearchHit[] => {
    const summary = summaries.get(hit.templateId);
    if (!summary) return [];
    const slot = hit.slotId ? slots.get(hit.slotId) : undefined;
    return [
      { summary, score: hit.score, matchedBy: hit.matchedBy, slotId: hit.slotId, ...(slot ? { slot } : {}) },
    ];
  });
}

export function createTemplateSearch(deps: TemplateSearchDeps): TemplateSearch {
  const fusion = deps.fusion ?? TEMPLATE_SEARCH_V1;
  return {
    async search(query, signal): AsyncResult<TemplateSearchResult> {
      // The templates the query's filters keep (a search query is a list query with words and no sort): the words
      // are read among them, the vector hits kept to them.
      const where = listFilters(query, {
        now: deps.db.clock(),
        staleAfterDays: storedSetting(deps.db, STALE_AFTER_DAYS_SETTING),
      });
      const scope = where === null ? [] : idsWhere(deps.db, where);
      const words = wordList(deps.db, query.text, fusion.wordLimit, scope);
      const meaning = await meaningLists(deps, query.text, fusion, signal);
      if (!meaning.ok) return meaning;
      const lists: Lists = { words, ...(meaning.value ?? {}) };
      return ok({
        hits: hitsOf(deps.db, new Set(scope), fuse(lists, fusion), query.limit),
        degraded: meaning.value ? null : 'keyword-only',
        fusion: fusion.version,
      });
    },
  };
}
