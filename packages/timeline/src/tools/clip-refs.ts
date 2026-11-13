// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: a clip as a person says it, for the editor tools: its number as the editor shows it (core's
 * `editItemsOf`: clip 1, 2, 3 in the video's order, the same numbers as the chat's chips and the changes card), or
 * "this", "next" and "previous", which the tool works out from what the person pointed at (a docked run's
 * `ctx.editor`). On the 9B every clip a run changed by mistake was the right clip's neighbour, its whole id copied
 * from the next row: a number the model says in its own words is a handle it doesn't miscopy. A number counts on
 * the revision it was read at; when the video has moved on since, the call is refused with the clips as they are
 * numbered now.
 */
import {
  editItemsOf,
  err,
  ok,
  RationalTime,
  type AsyncResult,
  type EditTarget,
  type Timeline,
  type ToolEditorContext,
  wrapUntrusted,
} from '@taalcut/core';
import { z } from 'zod';
import { InvalidMove } from '../errors';
import { videoItems } from '../model/sequence';
import type { ShotDescriptions } from './rerank-material';

export const CLIP_WORDS = ['this', 'next', 'previous'] as const;
export type ClipWord = (typeof CLIP_WORDS)[number];
/** A number, a word, or a string: a number written as one ("3"), or an item's id. */
export type ClipRef = number | string;

/**
 * A clip as the model writes it. The 9B wrote numbers as strings ("3") as often as not, so a string of digits is a
 * number; any other string is an id (a voice line's, an effect's, or a clip's when a model has one).
 */
export const clipRefSchema = z
  .union([z.int().min(0).max(400), z.enum(CLIP_WORDS), z.string().min(1).max(40)])
  .describe(
    'The clip by its number, as timeline.get numbers it (3 is clip 3); or "this" for what the person pointed at (the selected clip, else the one at the playhead), "next" and "previous" for the clip after or before it',
  );

export const clipRefsSchema = z
  .array(clipRefSchema)
  .min(1)
  .max(60)
  .describe('The clips by their numbers ([3, 4]), or ["this"] for what the person pointed at, a selected stretch being every clip in it');

/** The ids, when every ref is one: nothing to look up, so no timeline is needed. */
export function idsOnly(refs: readonly ClipRef[]): string[] | null {
  const ids = refs.map(kindOf).map((kind) => ('id' in kind ? kind.id : null));
  return ids.every((id): id is string => id !== null) ? [...new Set(ids)] : null;
}

/** A ref as what it is: a number (digits included), one of the words, or an id. */
function kindOf(ref: ClipRef): { number: number } | { word: ClipWord } | { id: string } {
  if (typeof ref === 'number') return { number: ref };
  const trimmed = ref.trim();
  if (/^\d{1,3}$/.test(trimmed)) return { number: Number(trimmed) };
  const word = trimmed.toLowerCase();
  if ((CLIP_WORDS as readonly string[]).includes(word)) return { word: word as ClipWord };
  return { id: trimmed };
}

export const readRevisionSchema = z
  .int()
  .min(1)
  .optional()
  .describe('The revision timeline.get showed when you read the clip numbers');

/** A clip as the editor numbers it, with its place in frames. */
export interface NumberedClip {
  readonly id: string;
  readonly number: number;
  readonly start: number;
  readonly end: number;
  readonly shotId: string | null;
}

/** The video's clips in order, numbered as the editor shows them (1 is the first; gaps don't count). */
export function numberedClips(timeline: Timeline): NumberedClip[] {
  const shots = new Map(
    videoItems(timeline).flatMap((item) =>
      item.type === 'clip' ? [[item.id as string, item.media.kind === 'video' ? (item.media.shotId as string | null) : null]] : [],
    ),
  );
  return editItemsOf(timeline)
    .filter((place) => place.target.itemKind === 'clip')
    .map((place) => ({
      id: place.target.itemId as string,
      number: place.number,
      start: place.start,
      end: place.end,
      shotId: shots.get(place.target.itemId as string) ?? null,
    }));
}

const toFrames = (time: RationalTime, timeline: Timeline) =>
  RationalTime.rescale(time, timeline.canvas.rate, 'floor').value;

/** The clips a target covers: an item's clip, every clip a stretch overlaps; none for the whole video. */
function clipsOfTarget(target: EditTarget, clips: readonly NumberedClip[], timeline: Timeline): NumberedClip[] {
  if (target.kind === 'item') return clips.filter((clip) => clip.id === target.itemId);
  if (target.kind !== 'range') return [];
  const from = toFrames(target.range.start, timeline);
  const to = from + toFrames(target.range.duration, timeline);
  return clips.filter((clip) => clip.start < to && clip.end > from);
}

/**
 * What the person pointed at: the selection, else the clip under the playhead; with `words`, what the message's words
 * point at first (the brief's targets: "the next one" and "clip 3" as well as "this"). "this" is the selection or the
 * playhead's clip, never every clip the words name.
 */
export function pointedClips(timeline: Timeline, editor: ToolEditorContext, words = true) {
  const clips = numberedClips(timeline);
  const of = (targets: readonly EditTarget[]) => {
    const ids = new Set(targets.flatMap((target) => clipsOfTarget(target, clips, timeline)).map((clip) => clip.id));
    return clips.filter((clip) => ids.has(clip.id));
  };
  const targeted = words ? of(editor.targets) : [];
  if (targeted.length > 0) return { clips: targeted, by: 'targets' as const };
  const selected = of(editor.context.selection);
  if (selected.length > 0) return { clips: selected, by: 'selection' as const };
  const at = toFrames(editor.context.playhead, timeline);
  return { clips: clips.filter((clip) => clip.start <= at && at < clip.end), by: 'playhead' as const };
}

/**
 * Every clip the person pointed at, by number: the words' targets, the selection and the playhead's clip. A playhead
 * at the very start is where the editor opens, not a pointing: in eval run 10, "take the coffee shot out" deleted
 * clip 1 unread, the clip under a playhead at 0.
 */
function pointedNumbers(timeline: Timeline, editor: ToolEditorContext): Set<number> {
  const pointed = pointedClips(timeline, editor);
  const words = pointed.by === 'targets' ? pointed.clips : [];
  const selection = pointedClips(timeline, editor, false);
  const selected = selection.by === 'selection' ? selection.clips : [];
  const unmoved = toFrames(editor.context.playhead, timeline) <= 0;
  const playhead = unmoved
    ? []
    : pointedClips(timeline, { ...editor, targets: [], context: { ...editor.context, selection: [] } }, false).clips;
  return new Set([...words, ...selected, ...playhead].map((clip) => clip.number));
}

const refused = (detail: string) => err(InvalidMove(undefined, { detail }));

/**
 * "clip 1, clip 2, clip 3": the clips as numbered now, and what each shows when that is known, as one fenced block
 * after the refusal (vision's words are material, never instructions, and a tool's error isn't fenced for it).
 */
export async function numberedList(clips: readonly NumberedClip[], describe: ShotDescriptions | undefined) {
  const shotIds = clips.flatMap((clip) => (clip.shotId ? [clip.shotId] : []));
  const described = describe && shotIds.length > 0 ? await describe(shotIds as never).catch(() => null) : null;
  const lines = clips.flatMap((clip) => {
    const text = clip.shotId && described?.ok ? described.value.get(clip.shotId)?.trim() : undefined;
    return text ? [`clip ${clip.number}: ${text.length > 60 ? `${text.slice(0, 59).trimEnd()}…` : text}`] : [];
  });
  return {
    list: clips.map((clip) => `clip ${clip.number}`).join(', '),
    shows: lines.length > 0 ? `\n\nWhat each clip shows:\n${wrapUntrusted(lines.join('\n'), 'vision')}` : '',
  };
}

/** How many times a docked run is asked to read the timeline before its numbered calls go through unread. */
const READ_ASKS = 3;

/** How many revisions' numbering a set of tools remembers, the oldest forgotten first. */
const REMEMBERED_REVISIONS = 400;

/**
 * The clips' order at each revision the tools have seen, so a number read a few edits back still counts when it
 * still names the same clip (after a speed change or a colour every number does; after a split, the numbers up to the
 * split clip): one per set of tools (a module), shared by timeline.get and the edit tools.
 */
export interface ClipNumbering {
  remember(timeline: Timeline): void;
  /** The clips as numbered at `revision`, if `remember` saw that revision. */
  clipsAt?(timeline: Timeline, revision: number): readonly NumberedClip[] | undefined;
  /** True when clip `number` at `revision` is clip `number` in `timeline` now. */
  sameClip(timeline: Timeline, revision: number, number: number): boolean;
  /** timeline.get showed this revision in this run: the numbers a later call names were read there. */
  read(runId: string, timeline: Timeline): void;
  /** The revision this run last read the timeline at, if it did. */
  lastRead(runId: string, timelineId: string): number | undefined;
  /** True the first time it is asked for a run (and remembered), false after: a refusal that comes once per run. */
  firstAsk(runId: string, what: string): boolean;
  /** True the first `times` times it is asked for a run, false after: a refusal that comes up to that many times. */
  asks(runId: string, what: string, times: number): boolean;
}

const numberingByStore = new WeakMap<object, ClipNumbering>();

/**
 * One numbering per timeline store, so every module's tools on it count on the same reads: the `timeline` module's
 * and the sound's edits in the `audio` module. Each module had its own, so audio.setVolume asked a run that had read
 * the timeline to read it first (eval run 10: "mute the waves" then muted the dog).
 */
export function clipNumberingOf(store: object): ClipNumbering {
  const known = numberingByStore.get(store);
  if (known) return known;
  const numbering = createClipNumbering();
  numberingByStore.set(store, numbering);
  return numbering;
}

export function createClipNumbering(): ClipNumbering {
  const snapshots = new Map<string, readonly NumberedClip[]>();
  const reads = new Map<string, number>();
  const asked = new Map<string, number>();
  const key = (timeline: Timeline, revision: number) => `${timeline.id}@${revision}`;
  const bounded = (map: Map<string, unknown>) => {
    if (map.size > REMEMBERED_REVISIONS) map.delete(map.keys().next().value as string);
  };
  const numbering: ClipNumbering = {
    remember(timeline) {
      snapshots.set(key(timeline, timeline.revision), numberedClips(timeline));
      bounded(snapshots);
    },
    clipsAt(timeline, revision) {
      return snapshots.get(key(timeline, revision));
    },
    sameClip(timeline, revision, number) {
      const then = snapshots.get(key(timeline, revision))?.[number - 1]?.id;
      return then !== undefined && then === numberedClips(timeline)[number - 1]?.id;
    },
    read(runId, timeline) {
      numbering.remember(timeline);
      const at = `${runId}:${timeline.id}`;
      reads.delete(at);
      reads.set(at, timeline.revision);
      bounded(reads);
    },
    lastRead(runId, timelineId) {
      return reads.get(`${runId}:${timelineId}`);
    },
    firstAsk(runId, what) {
      return numbering.asks(runId, what, 1);
    },
    asks(runId, what, times) {
      const at = `${runId}:${what}`;
      const count = asked.get(at) ?? 0;
      if (count >= times) return false;
      asked.set(at, count + 1);
      bounded(asked);
      return true;
    },
  };
  return numbering;
}

export interface ClipRefScope {
  readonly timeline: Timeline;
  /** The docked run's brief: what "this" points at, and the revision its numbers were shown at. */
  readonly editor?: ToolEditorContext | undefined;
  /** The revision the model says it read the numbers at. */
  readonly revision?: number | undefined;
  readonly describe?: ShotDescriptions | undefined;
  readonly numbering?: ClipNumbering | undefined;
  /** The run, for the revision it last read the timeline at. */
  readonly runId?: string | undefined;
}

/**
 * The clips' ids for what the model wrote, in its order, each once. A number counts on the revision the model read
 * (given; else the one this run's timeline.get last showed; else the one the person was looking at; else the video's
 * own): when the clips have been renumbered since
 * (or the tools can't tell), the call is refused with the clips as numbered now. "this", "next" and "previous" need a
 * docked run.
 */
export async function resolveClipRefs(refs: readonly ClipRef[], scope: ClipRefScope): AsyncResult<string[]> {
  const { timeline, editor } = scope;
  const clips = numberedClips(timeline);
  scope.numbering?.remember(timeline);
  const kinds = refs.map(kindOf);
  const numbers = kinds.flatMap((kind) => ('number' in kind ? [kind.number] : []));
  if (numbers.length > 0) {
    const lastRead = scope.runId === undefined ? undefined : scope.numbering?.lastRead(scope.runId, timeline.id);
    // A docked run that names a clip by number without having read the timeline, a clip the person didn't point at,
    // is asked to read it, up to three times until it does: the note lists the numbers only, and on the 9B "both beach
    // shots" became clips 4 and 6 unread; asked once, a second call in the same turn (eval run 12's grade beside its
    // speed change) still went through. A number the person pointed at (selected, at the playhead, named in the
    // words) needs no read.
    if (
      editor &&
      scope.runId !== undefined &&
      lastRead === undefined &&
      numbers.some((number) => !pointedNumbers(timeline, editor).has(number)) &&
      scope.numbering?.asks(scope.runId, 'read', READ_ASKS)
    ) {
      return refused(
        'Read the timeline with timeline.get first: the note lists the clips by number only, and what each clip ' +
          'shows ("the beach shots", "the dog") is in timeline.get. Then make the same call again with the numbers it shows.',
      );
    }
    const read = scope.revision ?? lastRead ?? editor?.context.revision ?? timeline.revision;
    const same = (number: number) => scope.numbering?.sameClip(timeline, read, number) ?? false;
    if (read !== timeline.revision && !numbers.every(same)) {
      const { list, shows } = await numberedList(clips, scope.describe);
      // The refusal shows the numbers as they are now: the run's next call counts on them.
      if (scope.runId !== undefined) scope.numbering?.read(scope.runId, timeline);
      return refused(
        `The clip numbers were read at revision ${read}, and the video is at revision ${timeline.revision} now, so ` +
          `its clips are numbered again: ${list}. Call again with revision ${timeline.revision} and the clip's number now.${shows}`,
      );
    }
  }
  const ids: string[] = [];
  const add = (id: string) => {
    if (!ids.includes(id)) ids.push(id);
  };
  for (const kind of kinds) {
    if ('id' in kind) {
      // An id goes through as given: a voice line's or an effect's, which have no number; the command checks it.
      add(kind.id);
      continue;
    }
    if ('number' in kind) {
      const clip = clips.find((candidate) => candidate.number === kind.number);
      if (!clip)
        return refused(
          `The video has ${clips.length} clips, numbered 1 to ${clips.length} (clip 1 is the first): there is no clip ${kind.number}.`,
        );
      add(clip.id);
      continue;
    }
    const ref = kind.word;
    if (!editor) return refused(`"${ref}" is what the person pointed at in the editor, and nothing was: give the clip's number.`);
    const pointing = pointedClips(timeline, editor, false);
    const pointed = pointing.clips;
    if (pointed.length === 0)
      return refused(`The person pointed at no clip (the playhead is past the last one): give the clip's number.`);
    // A playhead at the very start points at nothing (pointedNumbers): eval run 12 unmuted clip 1 as "this" for
    // "unmute the coffee clip".
    if (pointing.by === 'playhead' && toFrames(editor.context.playhead, timeline) <= 0)
      return refused(
        `"${ref}" is what the person pointed at, and nothing is: no clip is selected and the playhead is at the start. ` +
          "Give the clip's number from timeline.get, where what each clip shows is.",
      );
    if (ref === 'this') {
      for (const clip of pointed) add(clip.id);
      continue;
    }
    const from = ref === 'next' ? pointed.at(-1)! : pointed[0]!;
    const neighbour = clips.find((clip) => clip.number === from.number + (ref === 'next' ? 1 : -1));
    if (!neighbour)
      return refused(`Clip ${from.number} is the ${ref === 'next' ? 'last' : 'first'} clip: there is no ${ref} one.`);
    add(neighbour.id);
  }
  return ok(ids);
}

/** One clip's id: the ref when given (the handle the model doesn't miscopy), else the id, else a refusal. */
export async function oneClipId(
  given: { readonly clip?: ClipRef | undefined; readonly clipId?: string | undefined },
  scope: ClipRefScope,
): AsyncResult<string> {
  if (given.clip === undefined) {
    return given.clipId === undefined ? refused('Give the clip: its number (clip), or "this".') : ok(given.clipId);
  }
  const ids = await resolveClipRefs([given.clip], scope);
  if (!ids.ok) return ids;
  if (ids.value.length !== 1)
    return refused(`"this" is ${ids.value.length} clips here: give one clip's number, or call once for each.`);
  return ok(ids.value[0]!);
}

/** True when the ids are every clip of a video that has more than one. */
export function everyClip(timeline: Timeline, clipIds: readonly string[]): boolean {
  const clips = numberedClips(timeline);
  return clips.length > 1 && clips.every((clip) => clipIds.includes(clip.id));
}

/** The clip a shot is already in, by number: an insert of it is likely not the shot that was asked for. */
export function clipWithShot(timeline: Timeline, shotId: string | null): NumberedClip | null {
  if (!shotId) return null;
  return numberedClips(timeline).find((clip) => clip.shotId === shotId) ?? null;
}

