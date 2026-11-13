// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * profileOf (LRN1-STY): what a set of templates has in common, as core's StyleProfile. Pure and deterministic: no
 * model, no clock, no I/O. The members are sorted by id first, every number is rounded the same way, and the
 * exemplars come from the slot vectors given (exemplars.ts), so the same set gives byte-identical canonical JSON on
 * every run (`styleProfileJson`). The vectors are read by the caller (the builder) from the template index.
 */
import {
  STYLE_PROFILE_ALGORITHM,
  STYLE_PROFILE_MAX_MEMBERS,
  type StyleProfile,
  type Template,
  type TemplateRef,
} from '@taalcut/core';
import { canonicalJson, sha256Hex } from '../store/change-key';
import { medoids, type SlotVectorSet } from './exemplars';
import { audioPart, formPart, hookPart, mixPart, overlaysPart, pacingPart } from './profile-parts';

export interface ProfileVectors {
  /** The template index they were read from (templateIndexName). */
  readonly index: string;
  /** Slot-intent vectors of the members the index has; a member it lacks is left out of the exemplar pool. */
  readonly sets: readonly SlotVectorSet[];
}

const byId = (a: Template, b: Template) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The profile of these members; null for none. `vectors` null: the template index isn't open, no exemplars yet. */
export function profileOf(members: readonly Template[], vectors: ProfileVectors | null): StyleProfile | null {
  if (members.length === 0) return null;
  if (members.length > STYLE_PROFILE_MAX_MEMBERS)
    throw new RangeError(`profileOf takes at most ${STYLE_PROFILE_MAX_MEMBERS} members`);
  const sorted = [...members].sort(byId);
  const byTemplate = new Map(sorted.map((template) => [template.id, template]));
  const known = vectors ? vectors.sets.filter((set) => byTemplate.has(set.templateId)) : [];
  const chosen = vectors ? medoids(known) : { ids: [], pool: 0 };
  const exemplars = chosen.ids.flatMap((id) => {
    const template = byTemplate.get(id);
    return template ? [template] : [];
  });
  return {
    algorithm: STYLE_PROFILE_ALGORITHM,
    members: sorted.length,
    pacing: pacingPart(sorted),
    hook: hookPart(sorted, exemplars),
    mix: mixPart(sorted),
    overlays: overlaysPart(sorted),
    audio: audioPart(sorted),
    form: formPart(sorted),
    exemplars: exemplars.map((template) => ({ id: template.id, version: template.version })),
    exemplarPool: chosen.pool,
    exemplarIndex: vectors?.index ?? null,
  };
}

/** The profile as canonical JSON (keys sorted at every level): byte-identical for the same set. */
export function styleProfileJson(profile: StyleProfile): string {
  return canonicalJson(profile);
}

/**
 * What a stored profile was built from: the algorithm, the members at their versions and the template index the
 * exemplars came from. A new member, a new version, a member gone or the index opening (or changing with the
 * embedding model) changes it, and the profile is rebuilt; anything else leaves it.
 */
export function styleProfileDigest(members: readonly TemplateRef[], index: string | null): string {
  const refs = [...members]
    .map((ref) => ({ id: ref.id, version: ref.version }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.version - b.version));
  return sha256Hex(canonicalJson({ algorithm: STYLE_PROFILE_ALGORITHM, members: refs, index }));
}
