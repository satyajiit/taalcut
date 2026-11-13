// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: FIX-HOOK's needs matcher (casting/needs.ts) held to the one shot a draft's slot shows, for render QA's
 * `slotNeeds`. A need is met when the shot's description and objects name every thing the phrase names (its stems),
 * or when the phrase's embedding sits at least `terms.needMargin` above the pool's median cosine: the pool is the
 * draft's own shots and the cast's alternates, so "closer" means closer than this video's other footage. The verdict
 * also says how many other shots of the pool meet it, the candidates a swap could bring in. Nothing here knows what a
 * need is about.
 */
import type { ShotProfile } from '@taalcut/core';
import { dot, profileKey } from '../casting/catalog';
import type { CastingConfig } from '../casting/config';
import type { SlotNeed } from '../casting/needs';
import { shotTerms } from '../casting/terms';

export interface NeedVerdict {
  /** The Analyst's phrase. */
  readonly text: string;
  readonly met: boolean;
  /** How it was met: the shot's words name it, or its meaning sits closer than the pool's; null when unmet. */
  readonly by: 'words' | 'meaning' | null;
  /** Other shots of the pool that meet it. */
  readonly others: number;
}

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
};

const embedded = (profile: ShotProfile) => profile.embedding.length > 0;

/** How one pool shot meets one need: by its words, by meaning, or not. */
function meets(
  need: SlotNeed,
  profile: ShotProfile,
  bar: number,
  terms: (profile: ShotProfile) => ReadonlySet<string>,
): NeedVerdict['by'] {
  const shows = terms(profile);
  if (need.stems.length > 0 && need.stems.every((stem) => shows.has(stem))) return 'words';
  if (need.vector && embedded(profile) && dot(need.vector, profile.embedding) >= bar) return 'meaning';
  return null;
}

/**
 * Each need against `shot`, and how many of the pool's other shots meet it. The pool may hold the shot; it counts
 * once. Without a vector (no embedder) a need is read by its words only.
 */
export function needVerdicts(
  needs: readonly SlotNeed[],
  shot: ShotProfile,
  pool: readonly ShotProfile[],
  config: CastingConfig['terms'],
): NeedVerdict[] {
  const byKey = new Map<string, ShotProfile>([[profileKey(shot), shot]]);
  for (const profile of pool) if (!byKey.has(profileKey(profile))) byKey.set(profileKey(profile), profile);
  const all = [...byKey.values()];
  const cache = new Map<string, ReadonlySet<string>>();
  const terms = (profile: ShotProfile) => {
    const key = profileKey(profile);
    if (!cache.has(key)) cache.set(key, shotTerms(profile));
    return cache.get(key)!;
  };
  return needs.map((need) => {
    const vector = need.vector;
    const cosines = vector ? all.filter(embedded).map((profile) => dot(vector, profile.embedding)) : [];
    const bar = cosines.length > 0 ? median(cosines) + config.needMargin : Number.POSITIVE_INFINITY;
    const by = meets(need, shot, bar, terms);
    const others = all.filter(
      (profile) => profileKey(profile) !== profileKey(shot) && meets(need, profile, bar, terms) !== null,
    ).length;
    return { text: need.text, met: by !== null, by, others };
  });
}
