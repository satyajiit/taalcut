// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The gap fixes (P3-B8) as commands, each one undo step: fill a gap with a still or a video, drop a slot (ripple
 * or let a neighbour cover it), and mark slots the person will film. The agent proposes; these make the change.
 */
import {
  defineCommand,
  err,
  newId,
  ok,
  TIMELINE_COMMANDS,
  timelineCommandPayloads as payloads,
  type AsyncResult,
  type FrameRate,
  type RationalTime,
  type Result,
  type ShotProfile,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import type { z } from 'zod';
import { CASTING_CONFIG, type CastingConfig } from '../casting/config';
import { selectInPoint } from '../casting/in-points';
import { mediaRef, syncPointAt } from '../casting/result';
import type { SlotSpec } from '../casting/slots';
import type { Replacement } from '../edits/swap';
import type { EditOptions } from '../edits/types';
import { MediaTooShort } from '../errors';
import { dropSlot } from '../gaps/drop-slot';
import { fillGap, gapPosition, type GapFill } from '../gaps/fill-gap';
import { markForFilming } from '../gaps/film';
import { candidateKey } from '../model/cast';
import { writeEdit, type CommandDeps } from './context';
import { positionSpec, profilesFor } from './resolve';

type FillPayload = z.output<(typeof payloads)[typeof TIMELINE_COMMANDS.fillGap]>;
type VideoFill = Extract<FillPayload['media'], { readonly kind: 'video' }>;

/** Where the gap is and the casting rules its in-point follows. */
interface FillSlot {
  readonly spec: SlotSpec;
  readonly rate: FrameRate;
  readonly casting: CastingConfig;
}

/** A video in the gap: at the caller's in-point (with the sync point under it), else at the in-point rule's. */
function videoReplacement(
  profile: ShotProfile,
  sourceStart: RationalTime | undefined,
  slot: FillSlot,
  gapId: TimelineItemId,
): Result<Replacement> {
  const media = mediaRef(profile);
  if (sourceStart) {
    const syncPoint = syncPointAt(profile, slot.spec, sourceStart, slot.rate, slot.casting);
    return ok({ media, sourceStart, syncPoint, candidate: null });
  }
  const point = selectInPoint(profile, slot.spec, slot.rate, slot.casting, slot.spec.index === 0);
  if (!point) return err(MediaTooShort({ clipId: gapId }));
  return ok({ media, sourceStart: point.sourceStart, syncPoint: point.syncPoint, candidate: null });
}

/** The video's profile and the gap's slot, then its replacement. */
async function videoFill(
  deps: Pick<CommandDeps, 'catalog'> & { readonly casting: CastingConfig },
  timeline: Timeline,
  gapId: TimelineItemId,
  media: VideoFill,
): AsyncResult<GapFill> {
  const position = gapPosition(timeline, gapId);
  if (!position.ok) return position;
  const profiles = await profilesFor(deps.catalog, [{ assetId: media.assetId, shotId: media.shotId }]);
  if (!profiles.ok) return profiles;
  const profile = profiles.value.get(candidateKey(media)) as ShotProfile;
  const slot = {
    spec: positionSpec(timeline, position.value),
    rate: timeline.canvas.rate,
    casting: deps.casting,
  };
  const replacement = videoReplacement(profile, media.sourceStart, slot, gapId);
  return replacement.ok ? ok({ kind: 'video', replacement: replacement.value }) : replacement;
}

export function createGapCommands(deps: CommandDeps) {
  const casting = deps.casting ?? CASTING_CONFIG;
  const ids = deps.ids ?? (() => newId<'TimelineItem'>());
  const options = (source: EditOptions['source']) => ({
    source,
    ids,
    ...(deps.config ? { config: deps.config } : {}),
  });

  /** What fills the gap: a still as asked, or a video's media and in-point (the caller's, else the in-point rule). */
  async function resolveFill(timeline: Timeline, payload: FillPayload): AsyncResult<GapFill> {
    const media = payload.media;
    if (media.kind === 'image')
      return ok({ kind: 'image', assetId: media.assetId, stillMotion: media.stillMotion });
    return videoFill({ catalog: deps.catalog, casting }, timeline, payload.gapId, media);
  }

  const fill = defineCommand({
    name: TIMELINE_COMMANDS.fillGap,
    payload: payloads[TIMELINE_COMMANDS.fillGap],
    sideEffect: 'write',
    handle: (payload, context) =>
      writeEdit(deps, payload, context, async (timeline) => {
        const resolved = await resolveFill(timeline, payload);
        if (!resolved.ok) return resolved;
        return fillGap(timeline, payload.gapId, resolved.value);
      }),
  });

  const drop = defineCommand({
    name: TIMELINE_COMMANDS.dropSlot,
    payload: payloads[TIMELINE_COMMANDS.dropSlot],
    sideEffect: 'write',
    handle: (payload, context) =>
      writeEdit(deps, payload, context, (timeline) => dropSlot(timeline, payload, options(context.source))),
  });

  const film = defineCommand({
    name: TIMELINE_COMMANDS.markForFilming,
    payload: payloads[TIMELINE_COMMANDS.markForFilming],
    sideEffect: 'write',
    handle: (payload, context) =>
      writeEdit(deps, payload, context, (timeline) => markForFilming(timeline, payload)),
  });

  return { fill, drop, film, all: [fill, drop, film] };
}
