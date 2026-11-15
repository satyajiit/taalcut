// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What `timeline.cast` answers (per variant and slot the pick, its alternates and confidence; the rest is the
 * artifact), and MOM1's word on the parts the model stated: whether a stated part was kept, made longer to hold the
 * slot, or not used because another shot fills the slot. A slot says where its pick plays its shot from only when
 * the model can use it: a slot listed for a rerank (its candidates' moments are beside it) or one with a part.
 * MOM2: a part set aside for lying in a stretch where the camera is being handled (stated-parts.ts) says `handling`.
 */
import {
  keepsReelFootage,
  RationalTime,
  type ArtifactRef,
  type Clip,
  type ShotProfile,
  type Template,
  type Timeline,
} from '@taalcut/core';
import type { z } from 'zod';
import type { CastingConfig } from '../casting/config';
import type { CastResult } from '../casting/engine';
import { windowFrames } from '../casting/in-points';
import { slotSpecs } from '../casting/slots';
import { partSetAside, type StatedPart } from '../casting/stated-parts';
import { consumedMedia } from '../model/speed';
import type { GraphicsWait } from './graphics-wait';
import type { RerankSlot } from './rerank-material';
import type { castToolOutputSchema } from './schemas';

/** KEEP1: said in the answer of a cast whose template keeps some of the reel's own footage. */
export const REEL_KEPT_WORDS =
  "Slots noted reelKept are the reel's own footage: timeline.assemble fills them from the reel. They are not gaps: never lock, rerank or state a part for them.";

/** A time in a shot's file, in seconds to two decimals (as timeline.get's playsShotFrom). */
const shotSeconds = (time: RationalTime) => Math.round(RationalTime.toSeconds(time) * 100) / 100;

/**
 * What became of a stated part: the window inside it, the stretch made longer for the slot, another shot cast, or
 * (MOM2) the stretch not used because the camera is being handled in it.
 */
export type PartOutcome = 'kept' | 'widened' | 'otherShot' | 'handling';

/** The stated parts' shots, by shot id: the profiles their handling stretches are read from. */
export type PartProfiles = ReadonlyMap<string, ShotProfile>;

/** A twentieth of a second: a frame of slack for times read back in hundredths. */
const SLACK = 0.05;

/**
 * Whether a window that plays `seconds` from `playsFrom` lies inside the stated stretch; outside it, the stretch was
 * made longer, or (`setAside`) not used for the camera being handled in it.
 */
export function partOutcome(
  part: Pick<StatedPart, 'from' | 'to'>,
  playsFrom: number,
  seconds: number,
  setAside = false,
): Exclude<PartOutcome, 'otherShot'> {
  const inside =
    playsFrom >= part.from - SLACK &&
    (part.to === undefined || part.to <= part.from || playsFrom + seconds <= part.to + SLACK);
  return inside ? 'kept' : setAside ? 'handling' : 'widened';
}

export function castAnswer(
  result: CastResult,
  template: Template,
  config: CastingConfig,
  parts: readonly StatedPart[] | undefined,
  artifact: ArtifactRef,
  rerank: readonly RerankSlot[],
  graphics?: GraphicsWait,
  profiles?: PartProfiles,
): z.input<typeof castToolOutputSchema> {
  const specs = new Map(
    slotSpecs(template, config, result.canvas).map((spec) => [spec.slotId as string, spec]),
  );
  const seconds = (slotId: string) => {
    const spec = specs.get(slotId);
    return spec ? RationalTime.toSeconds(spec.consumes) : 0;
  };
  const setAside = (part: StatedPart) => {
    const profile = profiles?.get(part.shotId);
    const spec = specs.get(part.slotId);
    return profile && spec
      ? partSetAside(profile, windowFrames(spec, profile.range.start.rate), part, config.inPoint.handling)
      : false;
  };
  const listed = new Set(rerank.map((slot) => slot.slotId));
  return {
    castId: result.castId,
    configVersion: result.configVersion,
    variants: result.variants.map((variant) => ({
      sequenceConfidence: variant.sequenceConfidence,
      slots: variant.slots.map((slot) => {
        const stated = parts?.filter((part) => part.slotId === slot.slotId) ?? [];
        const shown = stated.length > 0 || listed.has(slot.slotId);
        const playsFrom = shown && slot.pick?.shotId ? shotSeconds(slot.pick.sourceStart) : null;
        const own = stated.find((part) => part.shotId === slot.pick?.shotId);
        return {
          slotId: slot.slotId,
          shotId: slot.pick?.shotId ?? null,
          assetId: slot.pick?.assetId ?? null,
          confidence: slot.confidence,
          needsRerank: slot.needsRerank,
          note: slot.note,
          alternates: slot.alternates.map((alternate) => alternate.shotId),
          ...(playsFrom !== null ? { playsShotFrom: playsFrom } : {}),
          ...(stated.length > 0
            ? {
                part:
                  own && playsFrom !== null
                    ? partOutcome(own, playsFrom, seconds(slot.slotId), setAside(own))
                    : ('otherShot' as const),
              }
            : {}),
        };
      }),
    })),
    ...(result.variantsShort ? { variantsShort: result.variantsShort } : {}),
    rerank: [...rerank],
    artifact,
    ...(graphics ? { graphics } : {}),
    ...(template.slots.some(keepsReelFootage) ? { reelKept: REEL_KEPT_WORDS } : {}),
  };
}

export interface PlacedPart {
  readonly timelineId: string;
  readonly slotId: string;
  readonly shotId: string;
  /** Where the slot's clip plays its shot from, in seconds of the file; null when another shot fills the slot. */
  readonly playsShotFrom: number | null;
  readonly part: PartOutcome;
}

/** `timeline.assemble`'s word on each stated part, read from the timelines it made. */
export function placedParts(
  timelines: readonly Timeline[],
  parts: readonly StatedPart[],
  handling?: { readonly profiles: PartProfiles; readonly config: CastingConfig['inPoint']['handling'] },
): PlacedPart[] {
  return timelines.flatMap((timeline) => {
    const v1 = timeline.tracks[0];
    const clips = (v1?.kind === 'video' ? v1.items : []).filter((item): item is Clip => item.type === 'clip');
    const rate = timeline.canvas.rate;
    return parts.map((part): PlacedPart => {
      const clip = clips.find(
        (item) =>
          item.slotId === part.slotId && item.media.kind === 'video' && item.media.shotId === part.shotId,
      );
      const base = { timelineId: timeline.id, slotId: part.slotId, shotId: part.shotId };
      if (!clip || clip.media.kind !== 'video') return { ...base, playsShotFrom: null, part: 'otherShot' };
      const playsFrom = shotSeconds(clip.sourceStart);
      const used = RationalTime.toSeconds(consumedMedia(clip, clip.media.available.start.rate, rate));
      const profile = handling?.profiles.get(part.shotId);
      const setAside =
        !!handling &&
        !!profile &&
        partSetAside(
          profile,
          RationalTime.rescale(
            consumedMedia(clip, profile.range.start.rate, rate),
            profile.range.start.rate,
            'ceil',
          ).value,
          part,
          handling.config,
        );
      return { ...base, playsShotFrom: playsFrom, part: partOutcome(part, playsFrom, used, setAside) };
    });
  });
}
