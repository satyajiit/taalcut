// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-HOOK: what a slot needs its footage to show (SPEC, "FIX-HOOK"). The Analyst states it from the reel, as up to
 * three short phrases on the slot's intent (`needs`): the thing or action the moment hangs on, including what a graphic
 * over it refers to. Nothing here knows what a need is about; it reads the phrase as words and as meaning.
 *
 * A shot meets a need when vision's description and objects show every thing the phrase names (terms.ts's stems), or
 * when the phrase's embedding is closer to the shot than to the slot's other candidates: at least `terms.needMargin`
 * above the pool's median cosine, so a synonym meets ("a handwritten note" for a shot of a letter) while a phrase every
 * shot sits near meets none. A need some candidate in the slot's pool meets costs each candidate that doesn't
 * `terms.requiredPenalty` (score.ts); a need no candidate meets costs nothing.
 */
import { chunk, ok, type AsyncResult, type Embedder, type ShotProfile, type SlotIntent } from '@taalcut/core';
import { dot, profileKey } from './catalog';
import type { CastingConfig } from './config';
import { thingTerms, type TermIndex } from './terms';

export interface SlotNeed {
  /** The Analyst's phrase. */
  readonly text: string;
  /** The things it names, as stems (terms.ts): a shot that shows them all meets it. */
  readonly stems: readonly string[];
  /** Its embedding (query purpose), once embedded with the cast's intents; null before. */
  readonly vector: Float32Array | null;
}

/** The slot's needs as its intent states them; none for an unwritten intent. */
export function slotNeeds(intent: SlotIntent): SlotNeed[] {
  if (intent.source === 'pending') return [];
  return [...new Set((intent.needs ?? []).map((text) => text.trim()).filter(Boolean))].map((text) => ({
    text,
    stems: thingTerms(text),
    vector: null,
  }));
}

/** The slot specs (slots.ts) with each need's embedding, every phrase embedded once. */
export async function withNeedVectors<S extends { readonly needs: readonly SlotNeed[] }>(
  specs: readonly S[],
  embedder: Embedder,
  signal?: AbortSignal,
): AsyncResult<S[]> {
  const texts = [...new Set(specs.flatMap((spec) => spec.needs.map((need) => need.text)))];
  if (texts.length === 0) return ok([...specs]);
  const vectors: Float32Array[] = [];
  // The embedder contract's batches of 64, as casting's intents (candidates.ts, embedAll).
  for (const batch of chunk(texts, 64)) {
    const result = await embedder.embedTexts(batch, { purpose: 'query', ...(signal ? { signal } : {}) });
    if (!result.ok) return result;
    vectors.push(...result.value);
  }
  const byText = new Map(texts.map((text, index) => [text, vectors[index] ?? null]));
  return ok(
    specs.map((spec) =>
      spec.needs.length === 0
        ? spec
        : { ...spec, needs: spec.needs.map((need) => ({ ...need, vector: byText.get(need.text) ?? null })) },
    ),
  );
}

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
};

/**
 * For each of a slot's candidate shots (by profileKey), how many of its needs the shot doesn't meet while another
 * candidate does. Empty when the slot has no need some candidate meets.
 */
export function unmetNeeds(
  needs: readonly SlotNeed[],
  profiles: readonly ShotProfile[],
  terms: TermIndex,
  config: CastingConfig['terms'],
): Map<string, number> {
  const unmet = new Map<string, number>();
  for (const need of needs) {
    const vector = need.vector;
    const cosines = vector ? profiles.map((profile) => dot(vector, profile.embedding)) : [];
    const bar = cosines.length > 0 ? median(cosines) + config.needMargin : Number.POSITIVE_INFINITY;
    const meets = profiles.map((profile, index) => {
      const shows = terms.of(profile);
      const named = need.stems.length > 0 && need.stems.every((stem) => shows.has(stem));
      return named || (cosines[index] ?? Number.NEGATIVE_INFINITY) >= bar;
    });
    if (!meets.some(Boolean)) continue;
    profiles.forEach((profile, index) => {
      const key = profileKey(profile);
      if (!meets[index]) unmet.set(key, (unmet.get(key) ?? 0) + 1);
    });
  }
  return unmet;
}
