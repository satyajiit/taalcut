// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-TRIM: where timeline.slipClip's `avoid` takes a clip in its shot (timeline SPEC, "FIX-TRIM: slipClip"). What to
 * keep out is the in-point rule's own parts, each on its own:
 * - `start`: the shot's onset (settle.ts), the recording's first second (recording.ts) and the person not yet under
 *   way (subject-terms.ts), so a later part;
 * - `end`: the shot's stop, the recording's last half second and the person slowing to a stop, so an earlier part;
 * - `face`: the share of the window a face may show in, inside the span the person was tracked over.
 * The windows with the least of these make the choice (a frame of a face is a face), which the in-point rule
 * (sharpness, the best frame, a peak on the beat) makes with a pull toward the clip's own part. A clip already as clear as its shot allows
 * (less than `minGain` to win) moves anyway for `start` or `end`, at least `stepSeconds` that way: the person sees
 * what the curves and boxes don't (a follow shot from behind reads as standing). For `face` it doesn't: nothing
 * measured says where a face isn't.
 */
import { RationalTime, type FrameRate, type ShotProfile, type SlipAvoid } from '@taalcut/core';
import type { CastingConfig } from './config';
import { selectInPoint, windowFrames, type InPoint } from './in-points';
import { recordingHandles, recordingPenalty } from './recording';
import { settleOf, settlePenalty } from './settle';
import type { SlotSpec } from './slots';
import { personEdges, type ShotPerson } from './subject-terms';

/** Why a slip found no part: no window that way, no gain for a face, or no face data to go by. */
export type SlipRefusal = 'noRoom' | 'noGain' | 'unknownFaces';

export type SlipChoice =
  | {
      readonly ok: true;
      readonly point: InPoint;
      /** What to avoid was measured in the shot; false when the clip moved a step on the person's word. */
      readonly measured: boolean;
    }
  | { readonly ok: false; readonly why: SlipRefusal };

export interface SlipPointInput {
  readonly profile: ShotProfile;
  readonly slot: SlotSpec;
  readonly canvasRate: FrameRate;
  readonly config: CastingConfig;
  /** The clip's in-point, media frames from the shot's start. */
  readonly current: number;
  readonly avoid: readonly SlipAvoid[];
  /** The person over the tracked span, when the shot was tracked and someone is in it. */
  readonly person: ShotPerson | null;
  /** The span was tracked (nobody in it, when `person` is null). */
  readonly tracked: boolean;
}

/** The part of its shot a clip plays to keep out what it should not show, or why there is none. */
export function slipPoint(input: SlipPointInput): SlipChoice {
  const { profile, slot, config, current, avoid, person } = input;
  const rate = profile.range.start.rate;
  const length = profile.range.duration.value;
  const window = windowFrames(slot, rate);
  const last = length - window;
  if (profile.kind !== 'video' || last < 0 || window < 1) return { ok: false, why: 'noRoom' };
  const inPoint = config.inPoint;
  const wants = (what: SlipAvoid) => avoid.includes(what);
  if (wants('face') && !input.tracked) return { ok: false, why: 'unknownFaces' };

  const framesAt = (index: number) => Math.round((index * inPoint.sampleMs * rate.num) / (1000 * rate.den));
  const settle = settleOf(profile.motionCurve, length, framesAt, inPoint.settle, inPoint.sampleMs);
  const handles = recordingHandles(profile, window, inPoint.recording);
  const edges = person ? personEdges(person, window, inPoint.subjects) : null;
  const onsetOnly = { ...inPoint.settle, stopWeight: 0 };
  const stopOnly = { ...inPoint.settle, onsetWeight: 0 };
  const firstOnly = { ...inPoint.recording, endWeight: 0 };
  const lastOnly = { ...inPoint.recording, startWeight: 0 };
  const shown = (start: number) => {
    let penalty = 0;
    if (wants('start'))
      penalty +=
        settlePenalty(settle, length, start, window, onsetOnly) +
        recordingPenalty(handles, start, window, firstOnly) +
        (edges ? edges.start(start) : 0);
    if (wants('end'))
      penalty +=
        settlePenalty(settle, length, start, window, stopOnly) +
        recordingPenalty(handles, start, window, lastOnly) +
        (edges ? edges.end(start) : 0);
    if (wants('face') && edges) penalty += edges.face(start);
    return penalty;
  };

  // Which way: later for the start alone, earlier for the end alone, either way otherwise.
  const way = (start: number, by: number) =>
    wants('face') || (wants('start') && wants('end'))
      ? Math.abs(start - current) >= by
      : wants('start')
        ? start - current >= by
        : current - start >= by;
  const tracked = (start: number) =>
    !wants('face') || !person || (start >= person.from && start + window <= person.to);
  const near = (start: number) => (inPoint.slip.nearWeight * Math.abs(start - current)) / length;
  const choose = (allowed: (start: number) => boolean): InPoint | null =>
    selectInPoint(profile, slot, input.canvasRate, config, slot.index === 0, { allowed, penalty: near });

  let floor = Number.POSITIVE_INFINITY;
  for (let start = 0; start <= last; start++)
    if (way(start, 1) && tracked(start)) floor = Math.min(floor, shown(start));
  const now = shown(Math.max(0, Math.min(last, current)));
  if (floor !== Number.POSITIVE_INFINITY && now - floor >= inPoint.subjects.minGain) {
    const bar = floor + config.tieEpsilon;
    const point = choose((start) => way(start, 1) && tracked(start) && shown(start) <= bar);
    if (point) return { ok: true, point, measured: true };
  }
  if (wants('face')) return { ok: false, why: 'noGain' };
  const step = RationalTime.fromSeconds(inPoint.slip.stepSeconds, rate, 'round').value;
  const point = choose((start) => way(start, step));
  return point ? { ok: true, point, measured: false } : { ok: false, why: 'noRoom' };
}
