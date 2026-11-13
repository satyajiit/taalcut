// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Story order without a reference (P2-M12, SPEC "Story order"): the brief's
 * shots in capture order, split into place blocks that stay contiguous, one
 * block's positions filled in capture order with the shots closest to each
 * position's target energy. The hook is the best hook in the first block,
 * the outro the calmest in the last.
 */
import type { ShotProfile, Template } from '@taalcut/core';
import type { Adjacency } from './alternates';
import type { Sequence } from './beam';
import { scoreCandidate, type Candidate, type SlotPool } from './candidates';
import { captureTime, profileKey } from './catalog';
import type { CastingConfig } from './config';
import { hookScore, shotEnergy } from './score';
import type { SlotSpec } from './slots';
import type { VariantSearch } from './variants';

const byCapture = (a: ShotProfile, b: ShotProfile) =>
  captureTime(a) - captureTime(b) || (profileKey(a) < profileKey(b) ? -1 : 1);

/** One shot per near-duplicate group: the best take, else the best quality (G25). */
export function collapseDuplicates(pool: readonly ShotProfile[]): ShotProfile[] {
  const groups = new Map<string, ShotProfile>();
  const out: ShotProfile[] = [];
  for (const profile of pool) {
    if (!profile.duplicateGroup) {
      out.push(profile);
      continue;
    }
    const held = groups.get(profile.duplicateGroup);
    const better =
      !held ||
      Number(profile.bestTake) - Number(held.bestTake) > 0 ||
      (profile.bestTake === held.bestTake && profile.quality > held.quality);
    if (better) groups.set(profile.duplicateGroup, profile);
  }
  return [...out, ...groups.values()].sort(byCapture);
}

/** Capture-ordered shots split where the place changes; a null place is its own block. */
export function placeBlocks(pool: readonly ShotProfile[], slots: number): ShotProfile[][] {
  const blocks: ShotProfile[][] = [];
  for (const profile of [...pool].sort(byCapture)) {
    const block = blocks.at(-1);
    const first = block?.[0];
    if (block && first?.placeClusterId !== null && first?.placeClusterId === profile.placeClusterId)
      block.push(profile);
    else blocks.push([profile]);
  }
  // More places than slots: the smallest block joins its smaller neighbour, keeping capture order.
  while (blocks.length > Math.max(1, slots)) {
    let smallest = 0;
    blocks.forEach((block, index) => {
      if (block.length < (blocks[smallest] as ShotProfile[]).length) smallest = index;
    });
    const before = blocks[smallest - 1];
    const after = blocks[smallest + 1];
    const into = !after || (before && before.length <= after.length) ? smallest - 1 : smallest + 1;
    const merged =
      into < smallest
        ? [...(blocks[into] as ShotProfile[]), ...(blocks[smallest] as ShotProfile[])]
        : [...(blocks[smallest] as ShotProfile[]), ...(blocks[into] as ShotProfile[])];
    blocks.splice(Math.min(into, smallest), 2, merged);
  }
  return blocks;
}

/**
 * Positions per block: one each, then the extra slots one at a time to the block with the most shots left
 * (ties to the earlier block), so long stays get more of the video without emptying shorter ones.
 */
export function blockQuotas(blocks: readonly ShotProfile[][], slots: number): number[] {
  const quotas: number[] = blocks.map(() => (slots > 0 ? 1 : 0));
  let extra = slots - blocks.length;
  while (extra > 0) {
    let best = -1;
    blocks.forEach((block, index) => {
      const room = block.length - (quotas[index] as number);
      if (room > 0 && (best < 0 || room > (blocks[best] as ShotProfile[]).length - (quotas[best] as number))) best = index;
    });
    if (best < 0) break;
    quotas[best] = (quotas[best] as number) + 1;
    extra--;
  }
  return quotas;
}

/** Target energy per position: the format's, or the sine shape when the slots have no intent yet. */
export function storyTargets(template: Template, specs: readonly SlotSpec[], config: CastingConfig): number[] {
  const n = specs.length;
  return specs.map((spec, index) => {
    if (template.slots[index]?.intent.source !== 'pending') return spec.energy;
    if (n <= 1) return config.story.energyBase + config.story.energyAmplitude / 2;
    return config.story.energyBase + config.story.energyAmplitude * Math.sin((Math.PI * index) / (n - 1));
  });
}

export interface StoryPlan {
  readonly pools: SlotPool[];
  /** The block each position draws from; null positions stay gaps (too few shots). */
  readonly blockOf: (number | null)[];
  readonly blocks: ShotProfile[][];
}

/** Scores every shot of a position's block for that position: energy closeness, plus the hook on slot 0. */
export function planStory(
  specs: readonly SlotSpec[],
  pool: readonly ShotProfile[],
  targets: readonly number[],
  context: { readonly config: CastingConfig; readonly recent: readonly Float32Array[] },
): StoryPlan {
  const blocks = placeBlocks(pool, specs.length);
  const quotas = blockQuotas(blocks, specs.length);
  const blockOf: (number | null)[] = [];
  quotas.forEach((quota, block) => {
    for (let count = 0; count < quota; count++) blockOf.push(block);
  });
  while (blockOf.length < specs.length) blockOf.push(null);
  const pools = specs.map((slot, index): SlotPool => {
    const block = blockOf[index];
    const target = { ...slot, energy: targets[index] ?? slot.energy };
    const shots = block === null || block === undefined ? [] : (blocks[block] as ShotProfile[]);
    const candidates = shots.map((profile): Candidate => {
      const scored = scoreCandidate(target, profile, null, context);
      const hook = index === 0 ? context.config.hook.weight * hookScore(profile, context.recent, context.config) : 0;
      return { ...scored, unary: scored.parts.energy + hook };
    });
    return { slot, candidates, locked: false, relaxed: false, reranked: false };
  });
  return { pools, blockOf, blocks };
}

/**
 * Picks `positions` shots from `candidates` (capture order) in increasing order, maximising the summed
 * value (dynamic programming); ties keep the earlier shots.
 */
function inOrder(
  positions: readonly number[],
  candidates: readonly Candidate[][],
  value: (position: number, candidate: Candidate) => number,
): (Candidate | null)[] {
  const q = positions.length;
  const shots = candidates[0]?.length ?? 0;
  if (q === 0) return [];
  if (shots < q) return positions.map(() => null);
  // best[j][i]: the best value placing positions j.. using shots i..
  const best = Array.from({ length: q + 1 }, () => new Float64Array(shots + 1).fill(Number.NEGATIVE_INFINITY));
  for (let i = 0; i <= shots; i++) (best[q] as Float64Array)[i] = 0;
  for (let j = q - 1; j >= 0; j--) {
    const row = best[j] as Float64Array;
    const next = best[j + 1] as Float64Array;
    for (let i = shots - (q - j); i >= 0; i--) {
      const take = value(positions[j] as number, (candidates[j] as Candidate[])[i] as Candidate) + (next[i + 1] as number);
      row[i] = Math.max(take, row[i + 1] as number);
    }
  }
  const out: (Candidate | null)[] = [];
  let i = 0;
  for (let j = 0; j < q; j++) {
    const row = best[j] as Float64Array;
    const next = best[j + 1] as Float64Array;
    while (i < shots) {
      const take = value(positions[j] as number, (candidates[j] as Candidate[])[i] as Candidate) + (next[i + 1] as number);
      if (take >= (row[i] as number) - 1e-12) break;
      i++;
    }
    out.push((candidates[j] as Candidate[])[i] ?? null);
    i++;
  }
  return out;
}

const hookValue = (candidate: Candidate) => candidate.parts.hook ?? 0;

/** The story search for one variant: hook, outro, then each block in capture order. */
export function storySearch(plan: StoryPlan, adjacency: Adjacency, config: CastingConfig): VariantSearch {
  return ({ extra, bannedHooks }) => {
    const n = plan.pools.length;
    const picks: (Candidate | null)[] = Array.from({ length: n }, () => null);
    const used = new Set<string>();
    const cost = (slot: number, key: string) => (extra ? extra(slot, key) : 0);
    const firstBlock = plan.blockOf[0];
    if (firstBlock !== null && firstBlock !== undefined) {
      const hook = [...(plan.pools[0]?.candidates ?? [])]
        .filter((candidate) => !bannedHooks?.has(candidate.key))
        .sort((a, b) => hookValue(b) - cost(0, b.key) - (hookValue(a) - cost(0, a.key)) || (a.key < b.key ? -1 : 1))[0];
      if (!hook) return [];
      picks[0] = hook;
      used.add(hook.key);
    }
    const lastBlock = plan.blockOf[n - 1];
    if (n > 1 && lastBlock !== null && lastBlock !== undefined) {
      const outro = (plan.pools[n - 1]?.candidates ?? [])
        .filter((candidate) => !used.has(candidate.key))
        .sort((a, b) => shotEnergy(a.profile, config) - shotEnergy(b.profile, config) || (a.key < b.key ? -1 : 1))[0];
      if (outro) {
        picks[n - 1] = outro;
        used.add(outro.key);
      }
    }
    plan.blocks.forEach((_, block) => {
      const positions = plan.blockOf.flatMap((of, slot) => (of === block && picks[slot] === null && slot !== 0 && slot !== n - 1 ? [slot] : []));
      const columns = positions.map((slot) => (plan.pools[slot]?.candidates ?? []).filter((candidate) => !used.has(candidate.key)));
      const chosen = inOrder(positions, columns, (slot, candidate) => candidate.unary - cost(slot, candidate.key));
      chosen.forEach((candidate, index) => {
        if (!candidate) return;
        picks[positions[index] as number] = candidate;
        used.add(candidate.key);
      });
    });
    let score = 0;
    picks.forEach((pick, slot) => {
      if (!pick) return;
      score += pick.unary - cost(slot, pick.key);
      const previous = slot > 0 ? picks[slot - 1] : null;
      if (previous) score -= adjacency(previous, pick);
    });
    const sequence: Sequence = { picks, score };
    return [sequence];
  };
}
