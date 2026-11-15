// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM1: a shot's moments, the time-ranged notes the describer gives beside its one sentence (core's `ShotMoment`).
 * The shot's frames are taken at a regular stride (stages.ts `describeFramesForShot`, by hardware tier), each at the
 * middle of an equal part of the shot, and each picture goes to the model after its own label ("Frame 3, at 1.2 s:").
 * The model says which runs of frames show what, by frame number, in its own words: also the runs that show nothing
 * in particular. Nothing here knows what a note is about.
 *
 * Frame numbers, not seconds: asked for seconds, the on-device 4B saw a shot change at its eighth frame of ten and
 * wrote the change at 5.8 s of a 4.8 s shot. A number printed beside the picture is read, not worked out. A run of
 * frames is the parts of the shot those frames stand for, so the times are made here.
 *
 * The answer is read leniently and normalised in code: runs become frames inside the shot (an answer in seconds,
 * `from`/`to`, is read too), ranges are put in order, a gap or an overlap between two is split at its middle, the
 * first starts at the shot's first frame and the last ends at its last, a stretch under `minMomentSeconds` joins its
 * neighbour, equal neighbours join, and at most `SHOT_MOMENT_LIMITS.count` stay. An answer with no usable range gives
 * null: the shot keeps its one sentence.
 *
 * MOM2: for each run the model also states whether the camera is held on what the run shows on purpose or is only
 * being handled (`"camera": "filming"` or `"handling"`), going by the frames in order. A run stated as handling is stored
 * `handling` (core's `ShotMoment.handling`); only that field is read, never a note's words. A handling stretch
 * reaches to the nearest frames seen held on either side (half a part past its own frames): the time between two
 * frames was not seen, so it is not counted as filmed on purpose.
 *
 * MOM3: a handling stretch is a take starting or stopping, so the statement stands only on the run or runs at a
 * shot's very start and very end, and never on all of a shot (`takeEndsOnly`, and the end of `shotMoments`). A run
 * stated in the middle, and every run of a shot stated all through, reads as filming.
 */
import { SHOT_MOMENT_LIMITS, type ShotMoment } from '@taalcut/core';
import { VISION_CONFIG } from '../config';

/** MOM1's ask: each run with its note. The `moments` field of the describer's JSON, in the system prompt. */
export const MOMENTS_FIELD_PLAIN =
  '"moments": the shot as consecutive runs of its numbered frames, a new run wherever what the camera shows changes: [{"fromFrame": the run\'s first frame number, "toFrame": its last frame number, "note": one plain phrase under 120 characters saying what the camera shows in those frames}], in order, every frame in exactly one run, the first run from frame 1 and the last run to the last frame; frames that show the same thing share one run; a note says what is visible in its own frames only, never what comes before or after them; give every run a note, also when the camera shows nothing in particular (pointed away, moving between things, blurred),';

/** MOM2's ask: each run also states its camera, filming or handling (`statesHandling`). */
export const MOMENTS_FIELD_HANDLING =
  '"moments": the shot as consecutive runs of its numbered frames, a new run wherever what the camera shows changes: [{"fromFrame": the run\'s first frame number, "toFrame": its last frame number, "note": one plain phrase under 120 characters saying what the camera shows in those frames, "camera": "filming" or "handling"}], in order, every frame in exactly one run, the first run from frame 1 and the last run to the last frame; frames that show the same thing share one run; a note says what is visible in its own frames only, never what comes before or after them; give every run a note, also when the camera shows nothing in particular (pointed away, moving between things, blurred); "camera" is "filming" for a run the person filming aimed the camera at, which is most runs, and for a shot that is one run: a view the shot keeps to, and a pan, a turn, a walk or a ride that goes on showing the scene, are "filming" whatever they show, however low the camera points and however much it moves; "camera" is "handling" only where, going by the frames in order, the take is stopping or starting and the camera is not aimed at anything: the runs from where it drops away from what the shot was aimed at, or is covered, to the end of the shot, and the runs at the start of the shot while it is still being raised into place,';

/** The ask in use (config `describe.moments.statesHandling`). */
export const MOMENTS_FIELD = VISION_CONFIG.describe.moments.statesHandling
  ? MOMENTS_FIELD_HANDLING
  : MOMENTS_FIELD_PLAIN;

/** MOM2: the value of a run's `camera` field that states the camera is being handled (the other is "filming"). */
export const CAMERA_HANDLED = 'handling';

const tenth = (seconds: number) => String(Math.round(seconds * 10) / 10);

/** What a frame's picture is labelled with: its number (from 1) and its time in the shot. */
export const frameLabel = (index: number, seconds: number): string =>
  `Frame ${index + 1}, at ${tenth(seconds)} s:`;

/** The ask for a shot's numbered frames. */
export function momentsRequestText(times: {
  readonly at: readonly number[];
  readonly seconds: number;
}): string {
  return (
    `These ${times.at.length} numbered frames are in chronological order from one continuous shot ` +
    `${tenth(times.seconds)} s long; each picture comes after its number and time. Describe the full shot and its ` +
    'moments as JSON.'
  );
}

/** The shot the moments lie in: its length in grid frames, the grid's frames per second, and the frames shown. */
export interface MomentSpan {
  readonly length: number;
  readonly fps: number;
  /** How many numbered frames the model was shown, each standing for an equal part of the shot. */
  readonly frames?: number;
}

/** A stated range in grid frames from the shot's start (not yet inside the shot), with its note. */
interface Stated {
  readonly from: number;
  readonly to: number;
  readonly note: string;
  /** MOM2: the model's own word that the camera is being handled in the run. */
  readonly handling: boolean;
  /** MOM2: how far a handling run reaches past its own frames on each side, in grid frames (0 for seconds). */
  readonly reach: number;
}

/** A number, or a number written as text ("1.5", "1.5s", "1.5 s"). */
function secondsOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*(?:s|sec|seconds)?\s*$/i.exec(value);
  return match ? Number(match[1]) : null;
}

const noteOf = (value: unknown): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, SHOT_MOMENT_LIMITS.chars).trim()
    : '';

const whole = (value: unknown): number | null => {
  const number = secondsOf(value);
  return number !== null && Number.isInteger(number) ? number : null;
};

const firstFrame = (raw: Record<string, unknown>) => whole(raw.fromFrame ?? raw.from_frame ?? raw.startFrame);

/**
 * MOM2: whether the model stated the run as the camera being handled: the `camera` field's value it was asked to
 * choose (`CAMERA_HANDLED`), or a `handling` flag. Only the stated field is read, never the note.
 */
function statedHandling(raw: Record<string, unknown>): boolean {
  const camera = raw.camera;
  if (typeof camera === 'string') return camera.trim().toLowerCase() === CAMERA_HANDLED;
  const flag = raw.handling;
  return flag === true || (typeof flag === 'string' && flag.trim().toLowerCase() === 'true');
}
const record = (entry: unknown): Record<string, unknown> | null =>
  entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>) : null;

/**
 * One entry of the model's list as grid frames: a run of numbered frames (`fromFrame`..`toFrame`, both included, each
 * frame standing for an equal part of the shot; `base` is the number the model gave the first frame), or seconds
 * (`from`/`to`, or `start`/`end`); and its `note` (or another name for it).
 */
function stated(entry: unknown, span: MomentSpan, base: number, readHandling: boolean): Stated | null {
  const raw = record(entry);
  if (!raw) return null;
  const note = noteOf(raw.note ?? raw.shows ?? raw.description ?? raw.text);
  if (!note) return null;
  const handling = readHandling && statedHandling(raw);
  const first = firstFrame(raw);
  const last = whole(raw.toFrame ?? raw.to_frame ?? raw.endFrame);
  if (span.frames && first !== null && last !== null) {
    const part = span.length / span.frames;
    // MOM2: each frame is the middle of its part, so a handling run reaches half a part past its own frames, to
    // the nearest frame seen held on either side: what lies between the two was not seen held.
    return last < first
      ? null
      : { from: (first - base) * part, to: (last - base + 1) * part, note, handling, reach: part / 2 };
  }
  const from = secondsOf(raw.from ?? raw.start);
  const to = secondsOf(raw.to ?? raw.end);
  return from === null || to === null || to <= from
    ? null
    : { from: from * span.fps, to: to * span.fps, note, handling, reach: 0 };
}

/**
 * MOM3: which stated runs stand. A handling stretch is a take starting or stopping, so by its own definition it is
 * the run or runs at the very start or the very end of a shot, and never all of a shot. A run stated anywhere else,
 * and every run of a shot whose runs are all stated, reads as filming: in the owner's app the on-device 9B stated
 * whole handheld pans run by run, and a shot that really is handling all through gives the tools nothing to move to.
 * It follows from the definition, not from what any note says. `runs` are in the shot's order.
 */
function takeEndsOnly(runs: readonly Stated[]): Stated[] {
  let lead = 0;
  while (lead < runs.length && runs[lead]!.handling) lead += 1;
  if (lead === runs.length) return runs.map((run) => ({ ...run, handling: false }));
  let trail = runs.length;
  while (trail > lead && runs[trail - 1]!.handling) trail -= 1;
  return runs.map((run, index) => (index >= lead && index < trail ? { ...run, handling: false } : run));
}

/** Removes the moment at `index`, its frames going to the one before it (to the one after for the first). */
function join(moments: ShotMoment[], index: number): void {
  const [gone] = moments.splice(index, 1);
  if (!gone) return;
  const before = moments[index - 1];
  const after = moments[index];
  if (before) moments[index - 1] = { ...before, end: gone.end };
  else if (after) moments[index] = { ...after, start: gone.start };
}

/**
 * The model's `moments` as stored moments of a shot `span.length` frames long, or null when none can be used (not a
 * list, no entry with times and a note, or a shot with no length).
 */
export function shotMoments(
  answer: unknown,
  span: MomentSpan,
  options: { readonly handling?: boolean } = {},
): ShotMoment[] | null {
  // MOM2: a run's camera is read only when the ask had the model state it (`statesHandling`).
  const readHandling = options.handling ?? VISION_CONFIG.describe.moments.statesHandling;
  const length = Math.floor(span.length);
  if (!Array.isArray(answer) || !(length > 0) || !(span.fps > 0)) return null;
  const inside = (frame: number) => Math.max(0, Math.min(length, Math.round(frame)));
  // The frames are numbered from 1; a model that counts from 0 says so with a run from frame 0.
  const base = answer.some((entry) => firstFrame(record(entry) ?? {}) === 0) ? 0 : 1;
  const runs = answer
    .flatMap((entry) => stated(entry, span, base, readHandling) ?? [])
    // A range wholly outside the shot ends where it starts once it is brought inside.
    .filter((entry) => inside(entry.to) > inside(entry.from))
    .sort((a, b) => inside(a.from) - inside(b.from) || inside(a.to) - inside(b.to));
  if (runs.length === 0) return null;
  // MOM3: only the stated runs at the shot's very start and very end stand, and never every run; then a standing
  // one reaches to the nearest frames seen filmed (MOM2).
  const entries = takeEndsOnly(runs).map((entry) => {
    const reach = entry.handling ? entry.reach : 0;
    return { ...entry, from: inside(entry.from - reach), to: inside(entry.to + reach) };
  });
  // Each boundary sits in the middle of the gap or overlap between two neighbours, never before the last one.
  // MOM2: between a handling stretch and a held one it sits at the handling stretch's own edge.
  const bounds: number[] = [0];
  for (let index = 1; index < entries.length; index++) {
    const before = entries[index - 1] as Stated;
    const after = entries[index] as Stated;
    const edge =
      before.handling === after.handling
        ? Math.round((before.to + after.from) / 2)
        : before.handling
          ? before.to
          : after.from;
    bounds.push(Math.max(bounds[index - 1] as number, Math.min(length, edge)));
  }
  bounds.push(length);
  const moments: ShotMoment[] = entries.map((entry, index) => ({
    start: bounds[index] as number,
    end: bounds[index + 1] as number,
    note: entry.note,
    ...(entry.handling ? { handling: true as const } : {}),
  }));
  const shortest = Math.max(1, Math.round(VISION_CONFIG.describe.moments.minMomentSeconds * span.fps));
  const lengthOf = (moment: ShotMoment) => moment.end - moment.start;
  // The shortest goes first, so a run of blips doesn't swallow a real stretch between them.
  const dropShortest = (under: number): boolean => {
    if (moments.length < 2) return false;
    let index = 0;
    for (let i = 1; i < moments.length; i++)
      if (lengthOf(moments[i] as ShotMoment) < lengthOf(moments[index] as ShotMoment)) index = i;
    if (lengthOf(moments[index] as ShotMoment) >= under) return false;
    join(moments, index);
    return true;
  };
  while (dropShortest(shortest));
  const same = (a: ShotMoment, b: ShotMoment) => a.note === b.note && !a.handling === !b.handling;
  for (let index = moments.length - 1; index > 0; index--)
    if (same(moments[index] as ShotMoment, moments[index - 1] as ShotMoment)) join(moments, index);
  while (moments.length > SHOT_MOMENT_LIMITS.count && dropShortest(Number.POSITIVE_INFINITY));
  if (moments.length === 0 || !(lengthOf(moments[0] as ShotMoment) > 0)) return null;
  // MOM3: joining a blip of filming into its handling neighbour can leave handling all through; that states none.
  return moments.every((moment) => moment.handling)
    ? moments.map(({ start, end, note }) => ({ start, end, note }))
    : moments;
}
