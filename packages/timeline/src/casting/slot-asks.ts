// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM1: what each slot states, embedded outside a cast: the intent's vector and each need's, for the in-points
 * assembly chooses again with the person (person-in-points.ts) and QA's placed-part check (match/part-verdict.ts).
 * A cast embeds its own (template-pools.ts). An embedder that isn't there, or fails, leaves the specs as they were:
 * the in-point rule and the check then read a shot as they did before MOM1.
 */
import type { Embedder } from '@taalcut/core';
import { embedAll } from './candidates';
import { withAskSet } from './moment-fit';
import { withNeedVectors, type SlotNeed } from './needs';

interface Asking {
  readonly intentText: string | null;
  readonly needs: readonly SlotNeed[];
}

type Asked<S> = S & {
  readonly intentVector?: Float32Array | null;
  readonly askSet?: readonly (readonly Float32Array[])[];
};

/** The specs with each slot's intent and needs embedded, and every slot's asks beside each (moment-fit.ts). */
export async function withAskVectors<S extends Asking>(
  specs: readonly S[],
  embedder: Embedder | undefined,
  signal?: AbortSignal,
): Promise<Asked<S>[]> {
  if (!embedder) return [...specs];
  const needed = await withNeedVectors(specs, embedder, signal);
  const plain = needed.ok ? needed.value : [...specs];
  const texts = [...new Set(plain.flatMap((spec) => (spec.intentText ? [spec.intentText] : [])))];
  const vectors = texts.length > 0 ? await embedAll(embedder, texts, signal) : null;
  if (vectors && !vectors.ok) return plain;
  const byText = new Map(texts.map((text, index) => [text, vectors?.value[index] ?? null]));
  return withAskSet(
    plain.map((spec) => ({
      ...spec,
      intentVector: spec.intentText ? (byText.get(spec.intentText) ?? null) : null,
    })),
  );
}
