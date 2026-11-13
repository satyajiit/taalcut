// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Building one set's profile (LRN1-STY): its members from the store, each member's version read and migrated, the
 * members' slot-intent vectors from the template index (synced first, so a template written while the index was
 * closed still counts), then profileOf. The digest says what it was built from; a stored profile with the same
 * digest is kept as it is.
 */
import {
  all,
  err,
  ok,
  styleProfileSchema,
  ValidationError,
  type AsyncResult,
  type StyleProfile,
  type StyleProfileStore,
  type StyleSource,
  type Template,
  type TemplateRef,
  type TemplateStore,
} from '@taalcut/core';
import { z } from 'zod';
import { migrateTemplate } from '../schema/migrations';
import type { TemplateVectors } from '../vectors/template-vectors';
import { slotIntentText } from '../vectors/texts';
import { intentVectorId } from '../vectors/vector-set';
import type { SlotVectorSet } from './exemplars';
import { profileOf, styleProfileDigest, type ProfileVectors } from './profile-of';

/** The template index of the active embedding space, while one is open. */
export interface OpenTemplateIndex {
  /** templateIndexName(space): part of the digest, so a new space rebuilds the exemplars. */
  readonly index: string;
  readonly vectors: Pick<TemplateVectors, 'sync' | 'get'>;
}

export interface BuildDeps {
  readonly store: Pick<StyleProfileStore, 'members'>;
  readonly templates: Pick<TemplateStore, 'get'>;
  /** Undefined while no embedding space is open: the profile then has no exemplars yet. */
  readonly index: () => Promise<OpenTemplateIndex | undefined>;
  readonly log?: (line: string) => void;
}

/** What a build found: the digest, the profile (null for an empty set) and the members it read. */
export interface BuiltProfile {
  readonly digest: string;
  readonly profile: StyleProfile | null;
  readonly members: readonly Template[];
}

/** The set's members and the digest a profile of them would have now. */
export async function plannedDigest(
  deps: Pick<BuildDeps, 'store' | 'index'>,
  source: StyleSource,
): AsyncResult<{
  readonly members: TemplateRef[];
  readonly digest: string;
  readonly open: OpenTemplateIndex | undefined;
}> {
  const members = await deps.store.members(source);
  if (!members.ok) return members;
  const open = await deps.index();
  return ok({ members: members.value, digest: styleProfileDigest(members.value, open?.index ?? null), open });
}

async function readMember(templates: Pick<TemplateStore, 'get'>, ref: TemplateRef): AsyncResult<Template> {
  const stored = await templates.get(ref.id, ref.version);
  if (!stored.ok) return stored;
  return migrateTemplate(stored.value.json, stored.value.schemaVersion);
}

/** Each member's slot-intent vectors the index holds, after syncing the members' sets. */
async function slotVectors(
  open: OpenTemplateIndex,
  members: readonly Template[],
  log: ((line: string) => void) | undefined,
  signal?: AbortSignal,
): AsyncResult<ProfileVectors | null> {
  const synced = await open.vectors.sync(
    members.map((template) => template.id),
    signal,
  );
  if (!synced.ok) {
    // The index can't be brought up to date now: no exemplars this time; the next refresh tries again.
    log?.(`style profile: the template index didn't sync (${synced.error.code}); exemplars wait`);
    return ok(null);
  }
  const idsOf = (template: Template) =>
    template.slots.flatMap((slot) => {
      const text = slotIntentText(slot);
      return text ? [intentVectorId(template.id, slot.id, text)] : [];
    });
  const stored = open.vectors.get(members.flatMap(idsOf));
  if (!stored.ok) return stored;
  const sets: SlotVectorSet[] = members.map((template) => ({
    templateId: template.id,
    vectors: idsOf(template).flatMap((id) => stored.value.get(id) ?? []),
  }));
  return ok({ index: open.index, sets });
}

export async function buildProfile(
  deps: BuildDeps,
  source: StyleSource,
  signal?: AbortSignal,
): AsyncResult<BuiltProfile> {
  const planned = await plannedDigest(deps, source);
  if (!planned.ok) return planned;
  const read = all(await Promise.all(planned.value.members.map((ref) => readMember(deps.templates, ref))));
  if (!read.ok) return read;
  const members = read.value;
  const vectors = planned.value.open
    ? await slotVectors(planned.value.open, members, deps.log, signal)
    : ok(null);
  if (!vectors.ok) return vectors;
  const index = vectors.value?.index ?? null;
  const profile = profileOf(members, vectors.value);
  const checked = profile === null ? null : styleProfileSchema.safeParse(profile);
  if (checked && !checked.success)
    return err(ValidationError({ field: 'profile' }, { detail: z.prettifyError(checked.error) }));
  return ok({
    digest: styleProfileDigest(planned.value.members, index),
    profile: checked ? checked.data : null,
    members,
  });
}
