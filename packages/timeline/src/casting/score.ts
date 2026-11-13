// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The score (SPEC, casting steps 2 and 3): five unary parts on 0..1 weighted
 * by the config, the hook bonus on slot 0, and penalties between neighbours.
 * Every number comes from the casting config.
 */
import type { ShotProfile } from '@taalcut/core';
import { attributeMatch, shotAttributes } from './attributes';
import type { CastingConfig } from './config';
import { dot } from './catalog';
import type { SlotSpec } from './slots';
import { PERSON_WORDS, termMatch, type TermIndex, type TermMatch } from './terms';

export interface Parts {
  readonly intent: number;
  readonly motion: number;
  readonly quality: number;
  readonly subject: number;
  readonly energy: number;
  /** Slot 0 only. */
  readonly hook: number | null;
  /** FIX-CAST: night for day, or facing away for facing the camera (attributes.ts). */
  readonly conflict?: boolean;
  /** FIX-STORY: the distinctive words the slot asks for that the shot shows, in `intent` (terms.ts). */
  readonly terms?: TermMatch;
  /**
   * FIX-HOOK: how many of the slot's needs (its intent's `needs`, needs.ts) the shot doesn't meet while another shot
   * the slot could take does. Each costs `terms.requiredPenalty`.
   */
  readonly unmet?: number;
}

const clamp01 = (value: number) => (value <= 0 ? 0 : value >= 1 ? 1 : value);

export function shotEnergy(profile: ShotProfile, config: CastingConfig): number {
  if (profile.energy !== null) return clamp01(profile.energy);
  if (profile.kind === 'image' || !profile.motionClass) return config.motion.energy.static;
  return config.motion.energy[profile.motionClass];
}

export function motionMatch(slot: SlotSpec, profile: ShotProfile, config: CastingConfig): number {
  const shot = profile.kind === 'image' ? 'static' : profile.motionClass;
  if (!slot.motion || !shot) return config.neutral.motion;
  if (slot.motion === shot) return config.motion.sameClass;
  const families = config.motion.families;
  return families[slot.motion] === families[shot] ? config.motion.sameFamily : 0;
}

/** Lower case, words between single spaces, padded: " a b " contains " b " as a whole word. */
const spaced = (text: string) =>
  ` ${text
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join(' ')} `;

export function subjectMatch(slot: SlotSpec, profile: ShotProfile, config: CastingConfig): number {
  let people = config.neutral.subject;
  if (slot.people !== null) {
    if (slot.people === 0) people = profile.faceCount === 0 ? 1 : config.subject.facesWhenNoneWanted;
    else people = profile.faceCount === 0 ? 0 : Math.min(1, profile.faceCount / slot.people);
  }
  const description = spaced(profile.description ?? '');
  if (!slot.subject || (profile.objectTags.length === 0 && description.trim().length === 0)) return people;
  const needle = spaced(slot.subject);
  // FIX-CAST: the subject is found in the tags, in the description, or (a person) in the people vision counted.
  const hit =
    profile.objectTags.some((tag) => spaced(tag) === needle) ||
    (needle.trim().length > 0 && description.includes(needle)) ||
    (PERSON_WORDS.has(needle.trim()) && profile.faceCount > 0);
  const tag = config.subject.tagWeight;
  return (1 - tag) * people + (hit ? tag : 0);
}

/**
 * FIX-CAST: how well a shot matches the slot's intent, 0..1: the cosine rescaled from its floor to its
 * ceiling, blended with the attributes both sides say (night or day, facing, indoors or out, shot size).
 * FIX-STORY: and with the distinctive things the slot asks for that the shot shows, as agreement weighing the
 * config's weight times their match: a word only this shot shows weighs like the cosine, one every shot
 * shares weighs nothing (terms.ts).
 */
export function intentMatch(
  slot: SlotSpec,
  profile: ShotProfile,
  cosine: number | null,
  config: CastingConfig,
  terms: TermMatch | null = null,
): { readonly value: number; readonly conflict: boolean } {
  if (cosine === null) return { value: config.neutral.intent, conflict: false };
  const { cosineFloor, cosineCeiling, weights } = config.intentMatch;
  const span = cosineCeiling - cosineFloor;
  const scaled = span > 0 ? clamp01((cosine - cosineFloor) / span) : clamp01(cosine);
  const match = attributeMatch(slot.attributes, shotAttributes(profile), config.intentMatch);
  const words = config.terms.weight * (terms?.score ?? 0);
  const total = weights.cosine + match.weight + words;
  const blended = total > 0 ? (weights.cosine * scaled + match.weight * match.score + words) / total : scaled;
  return {
    value: match.conflict ? blended * config.intentMatch.conflict : blended,
    conflict: match.conflict,
  };
}

/** 1 − the highest cosine to the newest library shots (itself excluded). */
export function novelty(profile: ShotProfile, recent: readonly Float32Array[]): number {
  let highest = 0;
  for (const other of recent) {
    if (other === profile.embedding) continue;
    highest = Math.max(highest, dot(profile.embedding, other));
  }
  return 1 - clamp01(highest);
}

/** How well a shot opens the video: motion energy, a face, novelty and sharpness. */
export function hookScore(
  profile: ShotProfile,
  recent: readonly Float32Array[],
  config: CastingConfig,
): number {
  const { hook } = config;
  return (
    hook.motion * shotEnergy(profile, config) +
    hook.face * (profile.faceCount > 0 ? 1 : 0) +
    hook.novelty * novelty(profile, recent) +
    hook.sharpness * clamp01(profile.sharpness)
  );
}

export function unaryParts(
  slot: SlotSpec,
  profile: ShotProfile,
  cosine: number | null,
  context: {
    readonly config: CastingConfig;
    readonly recent: readonly Float32Array[];
    readonly hook: boolean;
    /** FIX-STORY: the shots casting weighs, for each word's rarity; absent, words don't count. */
    readonly terms?: TermIndex;
    /** FIX-HOOK: the slot's needs this shot doesn't meet while another candidate does (needs.ts, withTerms). */
    readonly unmet?: number;
  },
): Parts {
  const { config } = context;
  const index = context.terms;
  const terms = index ? termMatch(slot.terms, index.of(profile), index, config.terms) : null;
  const intent = intentMatch(slot, profile, cosine, config, terms);
  const unmet = context.unmet ?? 0;
  return {
    intent: intent.value,
    ...(intent.conflict ? { conflict: true } : {}),
    ...(terms ? { terms } : {}),
    ...(unmet > 0 ? { unmet } : {}),
    motion: motionMatch(slot, profile, config),
    quality: clamp01(profile.quality),
    subject: subjectMatch(slot, profile, config),
    energy: 1 - Math.abs(slot.energy - shotEnergy(profile, config)),
    // FIX-STORY: the opening carries the story and its graphics, so the hook also counts what the slot names
    // that the shot shows. On the intent part alone, a rare match weighed no more than the search's trades.
    hook: context.hook
      ? hookScore(profile, context.recent, config) + config.hook.story * (terms?.score ?? 0)
      : null,
  };
}

export function unaryScore(parts: Parts, config: CastingConfig): number {
  const { weights } = config;
  const base =
    weights.intent * parts.intent +
    weights.motion * parts.motion +
    weights.quality * parts.quality +
    weights.subject * parts.subject +
    weights.energy * parts.energy;
  const conflict = parts.conflict ? config.intentMatch.conflictPenalty : 0;
  const unmet = (parts.unmet ?? 0) * config.terms.requiredPenalty;
  return (parts.hook === null ? base : base + config.hook.weight * parts.hook) - conflict - unmet;
}

/** Penalty for `next` right after `previous`: a near duplicate, the same file, the same place. */
export function adjacencyPenalty(previous: ShotProfile, next: ShotProfile, config: CastingConfig): number {
  const { penalties } = config;
  let penalty = 0;
  if (dot(previous.embedding, next.embedding) >= penalties.nearDuplicateCosine)
    penalty += penalties.nearDuplicate;
  if (previous.assetId === next.assetId) penalty += penalties.sameAsset;
  if (previous.placeClusterId !== null && previous.placeClusterId === next.placeClusterId)
    penalty += penalties.samePlace;
  return penalty;
}
