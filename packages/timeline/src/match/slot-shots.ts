// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: what the library knows of each draft clip's shot against the template slot it fills, for render QA's
 * slot match: the shot's camera move as the library measured it, and each of the slot's needs met or not
 * (shot-needs.ts). The pool a need's meaning is weighed in is the draft's own shots and every slot's cast alternates.
 * Read once per draft by the render root's `slotMatch` port.
 */
import {
  ok,
  type AsyncResult,
  type CameraMotion,
  type Clip,
  type Embedder,
  type ShotProfile,
  type ShotProfileRef,
  type ShotProfileSource,
  type Template,
  type Timeline,
} from '@taalcut/core';
import { profileKey } from '../casting/catalog';
import { CASTING_CONFIG, type CastingConfig } from '../casting/config';
import { slotNeeds, withNeedVectors, type SlotNeed } from '../casting/needs';
import { videoItems } from '../model/sequence';
import { needVerdicts, type NeedVerdict } from './shot-needs';

export interface SlotShot {
  readonly clipId: string;
  readonly slotId: string;
  /** The shot's camera move as the library measured it (a photo is static); null when unknown. */
  readonly motion: CameraMotion | null;
  readonly needs: readonly NeedVerdict[];
}

export interface SlotShotsDeps {
  readonly profiles: Pick<ShotProfileSource, 'profiles'>;
  /** The query embedder; without it a need is read by its words only. */
  readonly embedder?: Embedder;
  readonly config?: CastingConfig;
  readonly signal?: AbortSignal;
}

const refOf = (clip: Clip): ShotProfileRef | null =>
  clip.media.kind === 'audio'
    ? null
    : { assetId: clip.media.assetId, shotId: clip.media.kind === 'video' ? clip.media.shotId : null };

const keyOf = (ref: ShotProfileRef) => ref.shotId ?? `asset:${ref.assetId}`;

/** The V1 clips that fill a slot of the template, enabled. */
function slotClips(timeline: Timeline, template: Template): Clip[] {
  const slots = new Set<string>(template.slots.map((slot) => slot.id));
  return videoItems(timeline).filter(
    (item): item is Clip =>
      item.type === 'clip' && item.enabled && item.slotId !== null && slots.has(item.slotId),
  );
}

/** Each slot's needs, embedded once (the embedder's errors leave the needs to their words). */
async function needsBySlot(
  template: Template,
  deps: SlotShotsDeps,
): Promise<Map<string, readonly SlotNeed[]>> {
  const specs = template.slots.map((slot) => ({ slotId: slot.id as string, needs: slotNeeds(slot.intent) }));
  const embedded = deps.embedder ? await withNeedVectors(specs, deps.embedder, deps.signal) : null;
  return new Map((embedded?.ok ? embedded.value : specs).map((spec) => [spec.slotId, spec.needs]));
}

export async function slotShots(
  timeline: Timeline,
  template: Template,
  deps: SlotShotsDeps,
): AsyncResult<SlotShot[]> {
  const clips = slotClips(timeline, template);
  if (clips.length === 0) return ok([]);
  const refs = new Map<string, ShotProfileRef>();
  for (const clip of clips) {
    const ref = refOf(clip);
    if (ref) refs.set(keyOf(ref), ref);
  }
  // The cast's alternates join the pool: shots the slot could take instead.
  for (const slot of timeline.cast?.slots ?? [])
    for (const candidate of [slot.pick, ...slot.alternates])
      if (candidate) refs.set(keyOf(candidate), { assetId: candidate.assetId, shotId: candidate.shotId });
  const profiles = await deps.profiles.profiles([...refs.values()], deps.signal);
  if (!profiles.ok) return profiles;
  const byKey = new Map<string, ShotProfile>(profiles.value.map((profile) => [profileKey(profile), profile]));
  const pool = [...byKey.values()];
  for (const profile of profiles.value) {
    const assetKey = `asset:${profile.assetId}`;
    if (!byKey.has(assetKey)) byKey.set(assetKey, profile);
  }
  const needs = await needsBySlot(template, deps);
  const config = (deps.config ?? CASTING_CONFIG).terms;
  return ok(
    clips.flatMap((clip): SlotShot[] => {
      const ref = refOf(clip);
      const shot = ref ? byKey.get(keyOf(ref)) : undefined;
      if (!shot) return [];
      return [
        {
          clipId: clip.id,
          slotId: clip.slotId as string,
          motion: shot.kind === 'image' ? 'static' : shot.motionClass,
          needs: needVerdicts(needs.get(clip.slotId as string) ?? [], shot, pool, config),
        },
      ];
    }),
  );
}
