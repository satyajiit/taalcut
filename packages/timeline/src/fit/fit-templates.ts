// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * "What can I make with this footage?" (LRN1-TPL): casting step 1 run for every template in scope against one pool
 * of shots, never one index search per slot. The pool's vectors are read once and packed; the templates' stored
 * slot-intent vectors are read once from the template index (a template whose head has a vector the index lacks, one
 * edited a moment ago, is synced first); each distinct intent is scored against the pool once; every slot's
 * candidates are gathered and scored
 * by casting's own functions (slot-candidates.ts); distinct shots are matched to slots; templates rank by fit score,
 * coverage, then hook (score-template.ts). The same input and library give the same order.
 */
import {
  ConflictError,
  err,
  ok,
  type AsyncResult,
  type FitTemplatesInput,
  type FitTemplatesResult,
  type ShotProfileSource,
  type TemplateFit as TemplateFitView,
  type TemplateStore,
} from '@taalcut/core';
import { intentVectorId, textDigest, type TemplateVectors } from '@taalcut/templates';
import { profileKey } from '../casting/catalog';
import { staticCastingConfig, type CastingConfigSource } from '../casting/learned/config-source';
import { slotSpecs, type SlotSpec } from '../casting/slots';
import { createCosineTable, packPool } from './cosines';
import { loadPool, readHeads, templatesInScope, type TemplateHead } from './fit-inputs';
import { compareFits, scoreTemplate, type TemplateScore } from './score-template';
import { slotCandidates, type ScoreContext, type ShotPool } from './slot-candidates';

export interface TemplateFitDeps {
  /** Shot profiles whose vectors are in the same space as `vectors`. */
  readonly profiles: Pick<ShotProfileSource, 'list' | 'recent'>;
  readonly templates: Pick<TemplateStore, 'get' | 'list'>;
  /** The open space's template index; an error (vision.embedder_unavailable) while none is. */
  readonly vectors: () => AsyncResult<TemplateVectors>;
  /** Casting's config, resolved per fit (LRN1-PREF: the defaults with the learned weights). Absent: casting.v1. */
  readonly config?: CastingConfigSource;
}

export interface TemplateFitter {
  fitTemplates(input: FitTemplatesInput, signal?: AbortSignal): AsyncResult<FitTemplatesResult>;
}

interface Scored {
  readonly head: TemplateHead;
  readonly specs: readonly SlotSpec[];
  readonly score: TemplateScore;
  readonly templateId: string;
}

function view({ head, specs, score }: Scored): TemplateFitView {
  return {
    summary: head.summary,
    version: head.template.version,
    slots: score.slots,
    covered: score.covered,
    coverage: score.coverage,
    meanScore: score.meanScore,
    hook: score.hook,
    weakSlots: score.weak.map(({ index, reason }) => {
      const spec = specs[index] as SlotSpec;
      const slot = head.template.slots[index];
      return {
        slotId: spec.slotId,
        index,
        intent: (spec.intentText ?? '').slice(0, 500),
        shotType: slot?.intent.shotType ?? null,
        reason,
      };
    }),
  };
}

/** The slot vectors a head needs, by id (ids carry their text, so a stored id is a current vector). */
function intentIds(head: TemplateHead, specs: readonly SlotSpec[]): string[] {
  return specs.flatMap((spec) =>
    spec.intentText ? [intentVectorId(head.template.id, spec.slotId, spec.intentText)] : [],
  );
}

/**
 * Every slot vector the heads need, read in one pass. Templates missing any (written since the index last caught
 * up) are synced, and read again; one still missing a vector changed while fitting.
 */
async function storedIntents(
  vectors: TemplateVectors,
  heads: readonly TemplateHead[],
  specsOf: ReadonlyMap<string, SlotSpec[]>,
  signal?: AbortSignal,
): AsyncResult<Map<string, Float32Array>> {
  const wanted = heads.map((head) => ({
    templateId: head.template.id,
    ids: intentIds(head, specsOf.get(head.template.id) ?? []),
  }));
  const all = wanted.flatMap((item) => item.ids);
  const first = vectors.get(all);
  if (!first.ok) return first;
  const stale = wanted.filter((item) => item.ids.some((id) => !first.value.has(id)));
  if (stale.length === 0) return first;
  const synced = await vectors.sync(
    stale.map((item) => item.templateId),
    signal,
  );
  if (!synced.ok) return synced;
  const second = vectors.get(all);
  if (!second.ok) return second;
  const changed = all.find((id) => !second.value.has(id));
  return changed
    ? err(ConflictError({ entity: 'template' }, { detail: `changed while fitting (${changed}); try again` }))
    : second;
}

export function createTemplateFitter(deps: TemplateFitDeps): TemplateFitter {
  const source = deps.config ?? staticCastingConfig();
  return {
    async fitTemplates(input, signal) {
      const resolved = await source.resolve(signal);
      if (!resolved.ok) return resolved;
      const { config } = resolved.value;
      const vectors = await deps.vectors();
      if (!vectors.ok) return vectors;
      const ids = await templatesInScope(deps.templates, input.templates);
      if (!ids.ok) return ids;
      const heads = await readHeads(deps.templates, ids.value);
      if (!heads.ok) return heads;
      const loaded = await loadPool(deps.profiles, input.pool, vectors.value.dimensions, signal);
      if (!loaded.ok) return loaded;
      const recent = await deps.profiles.recent(config.hook.recentShots, signal);
      if (!recent.ok) return recent;

      const specsOf = new Map(
        heads.value.map((head) => [head.template.id, slotSpecs(head.template, config)]),
      );
      const stored = await storedIntents(vectors.value, heads.value, specsOf, signal);
      if (!stored.ok) return stored;

      const pool: ShotPool = { profiles: loaded.value.profiles, keys: loaded.value.profiles.map(profileKey) };
      const table = createCosineTable(
        packPool(
          pool.profiles.map((profile) => profile.embedding),
          vectors.value.dimensions,
        ),
      );
      const context: ScoreContext = { config, recent: recent.value, passing: new Map() };
      const scored: Scored[] = heads.value.map((head) => {
        const specs = specsOf.get(head.template.id) ?? [];
        const slots = specs.map((spec) => {
          const text = spec.intentText;
          const vector = text
            ? stored.value.get(intentVectorId(head.template.id, spec.slotId, text))
            : undefined;
          const cosines = text && vector ? table.of(textDigest(text), vector) : null;
          return slotCandidates(spec, cosines, pool, context);
        });
        return { head, specs, score: scoreTemplate(slots), templateId: head.template.id };
      });
      scored.sort((a, b) => compareFits(a, b, config));
      return ok({
        configVersion: resolved.value.label,
        poolShots: pool.profiles.length,
        poolTruncated: loaded.value.truncated,
        templates: scored.length,
        fits: scored.slice(0, input.limit).map(view),
      });
    },
  };
}
