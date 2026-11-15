// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: what the library knows of each draft clip's shot against the template slot it fills, for render QA's
 * slot match: the shot's camera move as the library measured it, and each of the slot's needs met or not
 * (shot-needs.ts). The pool a need's meaning is weighed in is the draft's own shots and every slot's cast alternates.
 * Read once per draft by the render root's `slotMatch` port. MOM1: and the part of the shot the clip plays against
 * what the slot states (part-verdict.ts). MOM2: the part is not read for a clip the person locked or whose cast slot
 * is the person's own pick (`userPick`: their swap, or their slip in the Trim tool): a part picked by hand stands.
 * MATCH1: nor for a clip whose slot states a moment that lands on its edge (core's `lands`): which part plays there
 * follows from the instant put on the cut (tools/landed-moments.ts), and a part that reads better elsewhere in the
 * shot would be a fix that takes the instant off it.
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
import { slotNeeds, type SlotNeed } from '../casting/needs';
import { withAskVectors } from '../casting/slot-asks';
import { intentText } from '../casting/slots';
import { videoItems } from '../model/sequence';
import { partVerdict, type PartVerdict } from './part-verdict';
import { needVerdicts, type NeedVerdict } from './shot-needs';

export interface SlotShot {
  readonly clipId: string;
  readonly slotId: string;
  /** The shot's camera move as the library measured it (a photo is static); null when unknown. */
  readonly motion: CameraMotion | null;
  readonly needs: readonly NeedVerdict[];
  /** MOM1: the part of the shot the clip plays against what the slot states; absent when nothing can be read. */
  readonly part?: PartVerdict;
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

interface SlotAsk {
  readonly needs: readonly SlotNeed[];
  readonly intentVector?: Float32Array | null;
  readonly askSet?: readonly (readonly Float32Array[])[];
}

/**
 * What each slot states, embedded once: its needs and (MOM1) its intent. The embedder's errors leave the needs to
 * their words and the played part unread.
 */
async function asksBySlot(template: Template, deps: SlotShotsDeps): Promise<Map<string, SlotAsk>> {
  const specs = template.slots.map((slot) => ({
    slotId: slot.id as string,
    needs: slotNeeds(slot.intent),
    intentText: intentText(slot),
  }));
  const embedded = await withAskVectors(specs, deps.embedder, deps.signal);
  return new Map(embedded.map((spec) => [spec.slotId, spec]));
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
  const asks = await asksBySlot(template, deps);
  const config = deps.config ?? CASTING_CONFIG;
  const picked = new Set(
    (timeline.cast?.slots ?? []).flatMap((slot) =>
      slot.note === 'userPick' && slot.clipId ? [slot.clipId as string] : [],
    ),
  );
  // MATCH1: the slots whose cut hangs on one instant of the footage.
  const landing = new Set(template.slots.flatMap((slot) => (slot.lands ? [slot.id as string] : [])));
  const own = (clip: Clip) => clip.locked || picked.has(clip.id) || landing.has(clip.slotId as string);
  const canvasRate = timeline.canvas.rate;
  return ok(
    clips.flatMap((clip): SlotShot[] => {
      const ref = refOf(clip);
      const shot = ref ? byKey.get(keyOf(ref)) : undefined;
      if (!shot) return [];
      const ask = asks.get(clip.slotId as string) ?? { needs: [] };
      // MOM2: a part the person chose (a slip or a swap of theirs, or a clip they locked) is never held to this;
      // MATCH1: nor one in a slot that states a moment for its edge.
      const part = own(clip) ? null : partVerdict(clip, shot, ask, canvasRate, config.inPoint);
      return [
        {
          clipId: clip.id,
          slotId: clip.slotId as string,
          motion: shot.kind === 'image' ? 'static' : shot.motionClass,
          needs: needVerdicts(ask.needs, shot, pool, config.terms),
          ...(part ? { part } : {}),
        },
      ];
    }),
  );
}
