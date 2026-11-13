// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-TRIM: timeline.slipClip (SPEC, "FIX-TRIM: slipClip"). By a time or to an in-point: inside the clip's shot (or
 * as far outside it as the clip already is), else a refusal saying how far it can go. Away from what it should not
 * show (`avoid`): the shot's profile and, when there is a subject source, the shot's track over the span assembly
 * reads (searchRange), made if need be within `slip.trackMs`; then slipPoint. One undo step. The overlays over the
 * clip are placed again (FRM1-OVL), unless placement's fallbacks would move the clip itself: the slip is what was
 * asked for.
 */
import {
  defineCommand,
  EDITOR_COMMANDS,
  editorCommandPayloads as payloads,
  err,
  ok,
  RationalTime,
  type AsyncResult,
  type CommandSource,
  type SlipAvoid,
  type Timeline,
} from '@taalcut/core';
import type { z } from 'zod';
import { ensureSubjects } from '../assembly/subjects';
import { searchRange } from '../assembly/person-in-points';
import { CASTING_CONFIG, type CastingConfig } from '../casting/config';
import { windowFrames } from '../casting/in-points';
import { syncPointAt } from '../casting/result';
import { slipPoint, type SlipRefusal } from '../casting/slip-point';
import { shotPerson, type ShotPerson } from '../casting/subject-terms';
import { slipClip, type SlipTo } from '../edits/slip';
import { clipPosition, type EditOptions } from '../edits/types';
import { InvalidMove } from '../errors';
import { candidateKey } from '../model/cast';
import { findPosition } from '../model/sequence';
import { writeEdit, type CommandDeps } from './context';
import { placedOver, replaceAfter } from './replace-after';
import { positionSpec, profilesFor } from './resolve';

type SlipPayload = z.output<(typeof payloads)[typeof EDITOR_COMMANDS.slipClip]>;

const refused = (detail: string) => err(InvalidMove(undefined, { detail }));
const tenths = (seconds: number) => Math.round(seconds * 10) / 10;

function refusal(why: SlipRefusal, avoid: readonly SlipAvoid[], tracking: boolean): string {
  if (why === 'unknownFaces')
    return tracking
      ? 'Taalcut is still looking for faces in this clip’s shot: try again in a moment.'
      : 'Taalcut can’t look for faces in this clip’s shot here.';
  if (why === 'noGain')
    return 'Every part of this clip’s shot shows a face as much as the clip does now: swap it for another shot instead (timeline.findAlternates).';
  if (avoid.length === 1 && avoid[0] === 'start')
    return 'This clip already plays the last part of its shot: nothing later in it is as long as the clip.';
  if (avoid.length === 1 && avoid[0] === 'end')
    return 'This clip already plays the first part of its shot: nothing earlier in it is as long as the clip.';
  return 'No other part of this clip’s shot is as long as the clip.';
}

/** Where the clip's new part starts, and the sync point under it. */
async function slipTarget(
  deps: CommandDeps,
  timeline: Timeline,
  payload: SlipPayload,
  source: CommandSource,
  config: CastingConfig,
): AsyncResult<SlipTo> {
  const found = clipPosition(timeline, payload.clipId, source);
  if (!found.ok) return found;
  const clip = found.value.item;
  if (clip.media.kind !== 'video') return refused('A photo has no other part to play.');
  const ref = { assetId: clip.media.assetId, shotId: clip.media.shotId };
  const profiles = await profilesFor(deps.catalog, [ref]);
  if (!profiles.ok) return profiles;
  const profile = profiles.value.get(candidateKey(ref))!;
  const spec = positionSpec(timeline, found.value);
  const rate = profile.range.start.rate;
  const fps = rate.num / rate.den;
  const frameOf = (time: RationalTime) =>
    RationalTime.subtract(RationalTime.rescale(time, rate, 'round'), profile.range.start).value;
  const current = frameOf(clip.sourceStart);
  const canvasRate = timeline.canvas.rate;
  const at = (frame: number) => RationalTime.add(profile.range.start, RationalTime.of(frame, rate));

  if (payload.avoid === undefined) {
    const asked = payload.sourceStart
      ? frameOf(payload.sourceStart)
      : current + RationalTime.rescale(payload.by!, rate, 'round').value;
    const low = Math.min(0, current);
    const high = Math.max(profile.range.duration.value - windowFrames(spec, rate), current);
    if (asked < low || asked > high) {
      const later = tenths((high - current) / fps);
      const earlier = tenths((current - low) / fps);
      return refused(
        later <= 0 && earlier <= 0
          ? 'This clip’s shot has no other part as long as the clip: shorten the clip first, or swap it.'
          : `This clip can play at most ${later} s later or ${earlier} s earlier in its shot.`,
      );
    }
    const sourceStart = at(asked);
    return ok({ sourceStart, syncPoint: syncPointAt(profile, spec, sourceStart, canvasRate, config) });
  }

  let person: ShotPerson | null = null;
  let tracked = false;
  if (deps.subjects) {
    const range = searchRange(profile, clip.sourceStart, spec, config);
    await ensureSubjects(deps.subjects, [range], config.inPoint.slip.trackMs);
    const span = await deps.subjects.over(range);
    if (span.ok && span.value) {
      tracked = true;
      person = shotPerson(profile, span.value, range, config.inPoint.subjects);
    }
  }
  const avoid = [...new Set(payload.avoid)];
  const choice = slipPoint({ profile, slot: spec, canvasRate, config, current, avoid, person, tracked });
  if (!choice.ok) return refused(refusal(choice.why, avoid, deps.subjects !== undefined));
  return ok({ sourceStart: choice.point.sourceStart, syncPoint: choice.point.syncPoint });
}

export function createSlipCommand(deps: CommandDeps) {
  const casting = deps.casting ?? CASTING_CONFIG;
  return defineCommand({
    name: EDITOR_COMMANDS.slipClip,
    payload: payloads[EDITOR_COMMANDS.slipClip],
    sideEffect: 'write',
    handle: (payload, context) =>
      writeEdit(deps, payload, context, async (timeline) => {
        const options: EditOptions = {
          source: context.source,
          ...(deps.config ? { config: deps.config } : {}),
        };
        const to = await slipTarget(deps, timeline, payload, context.source, casting);
        if (!to.ok) return to;
        const slipped = slipClip(timeline, payload.clipId, to.value, options);
        if (!slipped.ok || slipped.value.changed.length === 0) return slipped;
        // FRM1-OVL: other moments (other people, elsewhere) under the overlays now.
        const placed = await replaceAfter(
          deps,
          slipped.value,
          placedOver(slipped.value.timeline, [payload.clipId]),
          [payload.clipId],
        );
        if (!placed.ok) return slipped;
        const after = findPosition(placed.value.timeline, payload.clipId)?.item;
        const kept =
          after?.type === 'clip' &&
          RationalTime.compare(
            after.sourceStart,
            RationalTime.rescale(to.value.sourceStart, after.sourceStart.rate, 'round'),
          ) === 0;
        return kept ? placed : slipped;
      }),
  });
}
