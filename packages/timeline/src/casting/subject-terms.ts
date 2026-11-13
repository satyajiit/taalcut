// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-TRIM: the person's part in an in-point (SPEC, "FIX-TRIM: the person"). From a shot's subject span, the main
 * person's onset and stop and the moments that show a face, as terms on a window of the shot (media frames from its
 * start), which `selectInPoint` adds to its own:
 * - a slot whose moment is motion loses up to `onsetWeight` for the share of the window before the person is under
 *   way (`marginSeconds` after their first step), and the same for the share after they slow to a stop;
 * - another slot loses up to `straddleWeight` for a window the person gets going (or stops) inside, most at its
 *   middle: still throughout or under way throughout both read well;
 * - a slot that should show no face loses up to `faceWeight` for the share of the window a face may show in (each
 *   face moment standing for the frames up to the moments either side).
 * Only windows inside the tracked span may be chosen, so a window nobody looked at never wins by being unknown.
 */
import {
  RationalTime,
  reelSubjectsDuring,
  type ShotProfile,
  type SubjectClipRange,
  type SubjectSpan,
  type Template,
} from '@taalcut/core';
import type { CastingConfig } from './config';
import type { WindowTerms } from './in-points';
import type { SlotSpec } from './slots';
import { personMoves, personPace, showsFace, type PersonMoves, type PeopleAt } from './subject-motion';

/** What the slot's moment asks of the person. */
export interface SlotWants {
  /** The moment is motion: the person should be under way for the whole clip. */
  readonly moving: boolean;
  /** The moment shows no face (or the person asked for none). */
  readonly noFace: boolean;
}

/** The person in a shot, in media frames from the shot's start. */
export interface ShotPerson {
  readonly moves: PersonMoves;
  /** Under way from this frame; null when they are from the start, or never. */
  readonly onset: number | null;
  /** Still from this frame to the end; null when they don't stop. */
  readonly stop: number | null;
  /** `marginSeconds` in frames: a moving moment's window starts this long after the onset, ends this long before the stop. */
  readonly margin: number;
  /** The frames the span covers: [from, to). */
  readonly from: number;
  readonly to: number;
  /** Frames a face may show on, as running counts by frame (index f holds the count before frame f). */
  readonly faceFrames: Float64Array;
}

const words = (text: string | null) => new Set((text ?? '').toLowerCase().match(/[a-z]+/g) ?? []);

/**
 * Whether a slot's moment is motion and shows a face. The reel's own subjects decide when they show someone during
 * the slot (moving when they move for at least `reelMovingShare` of it); otherwise the slot's words, camera motion
 * and energy. No face: the intent says the reel hides it (FIX-HOOK, `face`); with no word on it, the reel shows nobody
 * there, or the slot's words say facing away, or no people.
 */
export function slotWants(
  slot: SlotSpec,
  template: Template,
  config: CastingConfig['inPoint']['subjects'],
): SlotWants {
  const reel = template.slots[slot.index];
  const samples =
    template.subjects && reel ? reelSubjectsDuring(template.subjects, reel.start, reel.duration) : [];
  const seen = samples.some((sample) => sample.people.length > 0 || sample.heads.length > 0);
  const aspect = template.canvas.width / template.canvas.height;
  const moments: PeopleAt[] = samples.map((sample) => ({
    t: RationalTime.toSeconds(sample.t),
    people: sample.people.length > 0 ? sample.people : sample.heads,
  }));
  const fromReel = seen ? personMoves(personPace(moments, aspect, config), config) : null;
  const said = words(slot.intentText);
  const moving =
    fromReel && fromReel.seen
      ? fromReel.movingShare >= config.reelMovingShare
      : config.movingWords.some((word) => said.has(word)) ||
        (slot.motion !== null && config.movingMotions.includes(slot.motion)) ||
        slot.energy >= config.movingEnergy;
  // FIX-HOOK: the Analyst says whether the reel shows the face (SlotIntent.face); the measures decide only when it
  // doesn't say. A reel that shows the person, from behind or turned away, has heads but no face to keep.
  const stated = reel?.intent.source === 'pending' ? undefined : reel?.intent.face;
  const noFace =
    stated === 'hidden'
      ? true
      : stated === 'shown'
        ? false
        : (samples.length > 0 && !seen) || slot.attributes.facing === 'away' || slot.people === 0;
  return { moving, noFace };
}

/** The person over a shot's subject span (`range`, the asset time it covers); null when nobody is in it. */
export function shotPerson(
  profile: ShotProfile,
  span: SubjectSpan,
  range: SubjectClipRange,
  config: CastingConfig['inPoint']['subjects'],
): ShotPerson | null {
  const rate = profile.range.start.rate;
  const origin = RationalTime.toSeconds(profile.range.start);
  const fps = rate.num / rate.den;
  const frameOf = (seconds: number) => Math.round((seconds - origin) * fps);
  const detect = span.samples.filter((sample) => sample.source === 'detect');
  const people: PeopleAt[] = detect.map((sample) => ({
    t: RationalTime.toSeconds(sample.t),
    people: sample.people && sample.people.length > 0 ? sample.people : sample.humans,
  }));
  const aspect = span.frame ? span.frame.width / span.frame.height : 1;
  const moves = personMoves(personPace(people, aspect, config), config);
  const moments = detect.map((sample) => ({
    frame: frameOf(RationalTime.toSeconds(sample.t)),
    face: showsFace(sample.faces, config),
  }));
  if (!moves.seen && !moments.some((moment) => moment.face)) return null;
  const length = profile.range.duration.value;
  const clamp = (frame: number) => Math.max(0, Math.min(length, frame));
  return {
    moves,
    onset: moves.onset === null ? null : clamp(frameOf(moves.onset)),
    stop: moves.stop === null ? null : clamp(frameOf(moves.stop)),
    margin: Math.round(config.marginSeconds * fps),
    from: clamp(frameOf(RationalTime.toSeconds(range.start))),
    to: clamp(frameOf(RationalTime.toSeconds(range.end))),
    faceFrames: faceCounts(moments, length),
  };
}

/**
 * Running counts of the frames a face may show on: each face moment stands for the frames up to the moments either
 * side of it (a face seen at 5.75 s and not at 6 s may show until 6 s), so a window clear of faces is clear between
 * samples too. The first and last moments stand for a step beyond them.
 */
function faceCounts(
  moments: readonly { readonly frame: number; readonly face: boolean }[],
  length: number,
): Float64Array {
  const marks = new Float64Array(length + 1);
  moments.forEach((moment, index) => {
    if (!moment.face) return;
    const before = moments[index - 1]?.frame;
    const after = moments[index + 1]?.frame;
    const step =
      after !== undefined ? after - moment.frame : before !== undefined ? moment.frame - before : 1;
    const from = Math.max(0, (before ?? moment.frame - step) + 1);
    const to = Math.min(length, Math.max(from + 1, after ?? moment.frame + step));
    for (let frame = from; frame < to; frame++) marks[frame + 1] = 1;
  });
  for (let frame = 1; frame <= length; frame++)
    marks[frame] = (marks[frame] as number) + (marks[frame - 1] as number);
  return marks;
}

/** The share of a window [start, start + window) outside [from, to), if any of it is. */
const before = (start: number, window: number, at: number) =>
  Math.max(0, Math.min(start + window, at) - start) / window;
const after = (start: number, window: number, at: number) =>
  Math.max(0, start + window - Math.max(start, at)) / window;
/** 1 for a moment at the window's middle, falling to 0 at its ends; 0 outside it. */
const inside = (start: number, window: number, at: number) =>
  at <= start || at >= start + window ? 0 : Math.min(at - start, start + window - at) / (window / 2);

/**
 * The person's parts of a window's penalty, each on its own: `start`, the share before they are under way (and the
 * margin after); `end`, the share after they slow to a stop (and the margin before); `straddle`, a start or stop
 * inside the window; `face`, the share a face may show in. Unweighted but for the config's weights.
 */
export function personEdges(
  person: ShotPerson,
  window: number,
  config: CastingConfig['inPoint']['subjects'],
): Readonly<Record<'start' | 'end' | 'straddle' | 'face', (start: number) => number>> {
  const counts = person.faceFrames;
  const last = counts.length - 1;
  const { onset, stop } = person;
  // A walk shorter than the window and both margins keeps less of them: the window still sits on the walk.
  const walk = onset !== null && stop !== null ? stop - onset : null;
  const margin =
    walk === null ? person.margin : Math.max(0, Math.min(person.margin, Math.floor((walk - window) / 2)));
  return {
    start: (start) => (onset === null ? 0 : config.onsetWeight * before(start, window, onset + margin)),
    end: (start) => (stop === null ? 0 : config.onsetWeight * after(start, window, stop - margin)),
    straddle: (start) =>
      (onset === null ? 0 : config.straddleWeight * inside(start, window, onset)) +
      (stop === null ? 0 : config.straddleWeight * inside(start, window, stop)),
    face: (start) =>
      (config.faceWeight *
        ((counts[Math.min(last, start + window)] as number) - (counts[Math.min(last, start)] as number))) /
      window,
  };
}

/** The person's terms on windows of `window` media frames, for selectInPoint. */
export function personTerms(
  person: ShotPerson,
  wants: SlotWants,
  window: number,
  config: CastingConfig['inPoint']['subjects'],
): WindowTerms {
  const edges = personEdges(person, window, config);
  return {
    allowed: (start) => start >= person.from && start + window <= person.to,
    penalty: (start) =>
      (wants.moving ? edges.start(start) + edges.end(start) : edges.straddle(start)) +
      (wants.noFace ? edges.face(start) : 0),
  };
}
