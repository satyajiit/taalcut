// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Bringing templates' sets up to date with their heads (LRN1-TPL). For each template: read its head, plan its set,
 * and compare the ids with what the index holds for it. The same ids: nothing to do. Otherwise the texts whose ids
 * aren't stored are embedded (across templates, in the embedder contract's batches of 64, one purpose per call) and
 * the template's set replaces its last one in one transaction (`replaceWhere` by `sourceId`), so a reader sees the
 * old set or the new one, never half. A template that is gone loses its vectors.
 */
import {
  chunk,
  err,
  NotFoundError,
  ok,
  type AsyncResult,
  type Embedder,
  type EmbeddingPurpose,
  type TemplateId,
  type TemplateStore,
  type VectorIndex,
} from '@taalcut/core';
import { migrateTemplate } from '../schema/migrations';
import { plannedVectors, type PlannedVector } from './vector-set';

export interface TemplateVectorDeps {
  /** The active space's template index (TemplateIndexToken). */
  readonly index: VectorIndex;
  /** The same space's embedder. */
  readonly embedder: Embedder;
  readonly store: Pick<TemplateStore, 'get' | 'list'>;
}

export interface TemplateVectorSync {
  /** Templates whose set was written. */
  readonly written: number;
  /** Templates already up to date. */
  readonly current: number;
  /** Templates gone from the store whose vectors were removed. */
  readonly removed: number;
  /** Texts embedded. */
  readonly embedded: number;
}

export const NO_SYNC: TemplateVectorSync = { written: 0, current: 0, removed: 0, embedded: 0 };

interface Plan {
  readonly templateId: TemplateId;
  readonly planned: readonly PlannedVector[];
  readonly stored: ReadonlyMap<string, Float32Array>;
}

type Planned = { readonly kind: 'current' | 'removed' } | { readonly kind: 'write'; readonly plan: Plan };

/** One text's key among the embedded: a document and a query of the same words are different vectors. */
const textKey = (purpose: EmbeddingPurpose, text: string) => `${purpose}\u0000${text}`;

const sameIds = (have: ReadonlySet<string>, want: readonly PlannedVector[]) =>
  have.size === want.length && want.every((item) => have.has(item.id));

async function planOne(deps: TemplateVectorDeps, templateId: TemplateId): AsyncResult<Planned> {
  const stored = await deps.store.get(templateId);
  if (!stored.ok) {
    if (!NotFoundError.is(stored.error)) return stored;
    const removed = deps.index.removeWhere({ sourceId: templateId });
    return removed.ok ? ok({ kind: 'removed' }) : removed;
  }
  const template = migrateTemplate(stored.value.json, stored.value.schemaVersion);
  if (!template.ok) return template;
  const { name, tags } = stored.value.summary;
  const planned = plannedVectors(template.value, { name, tags });
  const listed = deps.index.ids({ sourceId: templateId });
  if (!listed.ok) return listed;
  const have = new Set(listed.value);
  if (sameIds(have, planned)) return ok({ kind: 'current' });
  const kept = deps.index.get(planned.map((item) => item.id).filter((id) => have.has(id)));
  if (!kept.ok) return kept;
  return ok({ kind: 'write', plan: { templateId, planned, stored: kept.value } });
}

/** Every missing text's vector, by purpose and text (each embedded once). */
async function embedMissing(
  embedder: Embedder,
  plans: readonly Plan[],
  signal?: AbortSignal,
): AsyncResult<Map<string, Float32Array>> {
  const vectors = new Map<string, Float32Array>();
  for (const purpose of ['document', 'query'] as const) {
    const texts = [
      ...new Set(
        plans.flatMap((plan) =>
          plan.planned
            .filter((item) => item.purpose === purpose && !plan.stored.has(item.id))
            .map((item) => item.text),
        ),
      ),
    ];
    for (const batch of chunk(texts, 64)) {
      const embedded = await embedder.embedTexts(batch, { purpose, ...(signal ? { signal } : {}) });
      if (!embedded.ok) return embedded;
      batch.forEach((text, index) =>
        vectors.set(textKey(purpose, text), embedded.value[index] as Float32Array),
      );
    }
  }
  return ok(vectors);
}

function write(index: VectorIndex, plan: Plan, embedded: ReadonlyMap<string, Float32Array>) {
  const items = plan.planned.map((item) => {
    const vector = plan.stored.get(item.id) ?? embedded.get(textKey(item.purpose, item.text));
    if (!vector) throw new Error(`template vector ${item.id} was neither stored nor embedded`);
    return { id: item.id, vector, metadata: { sourceId: plan.templateId, kind: item.kind } };
  });
  return index.replaceWhere({ sourceId: plan.templateId }, items);
}

/** These templates' sets brought up to date with their heads, in the order given. */
export async function syncTemplates(
  deps: TemplateVectorDeps,
  templateIds: readonly TemplateId[],
  signal?: AbortSignal,
): AsyncResult<TemplateVectorSync> {
  let current = 0;
  let removed = 0;
  const plans: Plan[] = [];
  for (const templateId of new Set(templateIds)) {
    const planned = await planOne(deps, templateId);
    if (!planned.ok) return planned;
    if (planned.value.kind === 'write') plans.push(planned.value.plan);
    else if (planned.value.kind === 'current') current++;
    else removed++;
  }
  const embedded = await embedMissing(deps.embedder, plans, signal);
  if (!embedded.ok) return embedded;
  for (const plan of plans) {
    const written = write(deps.index, plan, embedded.value);
    if (!written.ok) return err(written.error);
  }
  return ok({ written: plans.length, current, removed, embedded: embedded.value.size });
}
