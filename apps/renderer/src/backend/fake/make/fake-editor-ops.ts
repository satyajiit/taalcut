// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the editor's new edits as the fake runs them, kept small: split, ripple delete, speed (the clip keeps
 * what it shows), transitions at a cut, colour and sound levels. Each is a timeline command whose inverse is
 * `timeline.restore` with the parts as they were (the whole video's grade and the mix too), so ⌘Z undoes it.
 * What follows a length change moves with it (text and captions); the real timeline also re-syncs the beats.
 */
import {
  AUDIO_EDIT_COMMANDS,
  defineCommand,
  EDITOR_COMMANDS,
  editorCommandPayloads,
  isNeutralGrade,
  MIN_CLIP_FRAMES,
  newId,
  RationalTime,
  type AnyCommand,
  type Clip,
  type ProjectId,
  type SequenceItem,
  type Timeline,
  type TimelineId,
  type TransitionItem,
} from '@taalcut/core';
import type { Edit } from './edits';
import { timelineError } from './edits';
import type { FakeTimelines } from './fake-timelines';

const P = editorCommandPayloads;
type Items = readonly SequenceItem[];

const v1 = (timeline: Timeline): Items =>
  timeline.tracks[0]?.kind === 'video' ? timeline.tracks[0].items : [];
const withV1 = (timeline: Timeline, items: Items): Timeline => ({
  ...timeline,
  tracks: timeline.tracks.map((track, index) =>
    index === 0 && track.kind === 'video' ? { ...track, items: [...items] } : track,
  ),
});
const frames = (item: SequenceItem) => (item.type === 'transition' ? 0 : item.duration.value);
const startOf = (items: Items, index: number) =>
  items.slice(0, index).reduce((sum, item) => sum + frames(item), 0);
const notFound = (id: string): Edit => ({
  ok: false,
  error: timelineError('timeline.item_not_found', { itemId: id }),
});
const invalid = (reason: string): Edit => ({
  ok: false,
  error: timelineError('timeline.invalid_move', { reason }),
});

/** Text, captions and markers at or after `at` move by `delta`; with a negative delta, what was inside goes. */
function shiftAfter(timeline: Timeline, at: number, delta: number): Timeline {
  if (delta === 0) return timeline;
  const rate = timeline.canvas.rate;
  const gone = (start: number) => delta < 0 && start >= at + delta && start < at;
  const moved = (start: number) => (start >= at ? start + delta : start);
  const tracks = timeline.tracks.map((track) =>
    track.kind !== 'text'
      ? track
      : {
          ...track,
          items: track.items
            .filter((item) => !gone(item.start.value))
            .map((item) => ({ ...item, start: RationalTime.of(moved(item.start.value), rate) })),
        },
  );
  const captions = timeline.captions && {
    ...timeline.captions,
    // A cue that reaches into a cut-out stretch goes with it (the real timeline rebuilds them from the words).
    cues: timeline.captions.cues
      .filter((cue) => {
        const start = cue.range.start.value;
        return !(delta < 0 && start < at && start + cue.range.duration.value > at + delta);
      })
      .map((cue) => {
        // A cue's words are on the timeline too: they move with it.
        const by = moved(cue.range.start.value) - cue.range.start.value;
        const shift = <T extends { range: { start: RationalTime } }>(entry: T): T => ({
          ...entry,
          range: { ...entry.range, start: RationalTime.of(entry.range.start.value + by, rate) },
        });
        return { ...shift(cue), words: cue.words.map(shift) };
      }),
  };
  return { ...timeline, tracks, ...(captions ? { captions } : {}) };
}

function clipIndex(items: Items, clipId: string): number {
  return items.findIndex((item) => item.id === clipId);
}

function split(timeline: Timeline, clipId: string, at: number, id: string): Edit {
  const items = v1(timeline);
  const index = clipIndex(items, clipId);
  const clip = items[index];
  if (!clip || clip.type !== 'clip') return notFound(clipId);
  const offset = at - startOf(items, index);
  if (offset < MIN_CLIP_FRAMES || clip.duration.value - offset < MIN_CLIP_FRAMES)
    return invalid('tooCloseToEdge');
  const rate = timeline.canvas.rate;
  const media = clip.sourceStart.rate;
  const into = RationalTime.rescale(RationalTime.of(offset, rate), media, 'round');
  const first: Clip = { ...clip, duration: RationalTime.of(offset, rate) };
  const second: Clip = {
    ...clip,
    id: id as Clip['id'],
    slotId: null,
    beatAnchor: null,
    syncPoint: null,
    duration: RationalTime.of(clip.duration.value - offset, rate),
    sourceStart: RationalTime.of(clip.sourceStart.value + into.value, media),
  };
  return {
    ok: true,
    timeline: withV1(timeline, [...items.slice(0, index), first, second, ...items.slice(index + 1)]),
  };
}

function rippleDelete(timeline: Timeline, clipId: string): Edit {
  const items = v1(timeline);
  const index = clipIndex(items, clipId);
  const item = items[index];
  if (!item || item.type === 'transition') return notFound(clipId);
  if (items.filter((each) => each.type === 'clip').length < 2 && item.type === 'clip')
    return invalid('lastClip');
  const end = startOf(items, index + 1);
  const kept = items.filter(
    (each, i) => i !== index && !(each.type === 'transition' && (i === index - 1 || i === index + 1)),
  );
  // Its cast slot keeps the pick, dropped, as the real delete does.
  const cast = timeline.cast && {
    ...timeline.cast,
    slots: timeline.cast.slots.map((slot) =>
      slot.clipId === item.id ? { ...slot, clipId: null, note: 'dropped' as const } : slot,
    ),
  };
  return { ok: true, timeline: shiftAfter({ ...withV1(timeline, kept), cast }, end, -frames(item)) };
}

function setSpeed(
  timeline: Timeline,
  input: { clipId: string; speed: { kind: string; speed?: number } },
): Edit {
  const items = v1(timeline);
  const index = clipIndex(items, input.clipId);
  const clip = items[index];
  if (!clip || clip.type !== 'clip') return notFound(input.clipId);
  if (clip.media.kind !== 'video') return invalid('notVideo');
  const rate = timeline.canvas.rate;
  const was = clip.speed?.points[0]?.speed ?? 1;
  const speed = input.speed.kind === 'constant' ? (input.speed.speed ?? 1) : 1;
  const length = Math.max(MIN_CLIP_FRAMES, Math.round((clip.duration.value * was) / speed));
  const next: Clip = {
    ...clip,
    duration: RationalTime.of(length, rate),
    speed:
      speed === 1
        ? null
        : {
            curve: 'hold',
            points: [
              { at: RationalTime.of(0, rate), speed },
              { at: RationalTime.of(length, rate), speed },
            ],
          },
    audio: { ...clip.audio, muted: clip.audio.muted || speed < 0.5 || speed > 2 },
  };
  const end = startOf(items, index + 1);
  const replaced = withV1(
    timeline,
    items.map((item, i) => (i === index ? next : item)),
  );
  return { ok: true, timeline: shiftAfter(replaced, end, length - clip.duration.value) };
}

function transitionAt(
  timeline: Timeline,
  clipId: string,
  edge: 'start' | 'end',
  make: (existing: TransitionItem | undefined) => TransitionItem | null,
): Edit {
  const items = v1(timeline);
  const index = clipIndex(items, clipId);
  if (index < 0) return notFound(clipId);
  const step = edge === 'end' ? 1 : -1;
  const there =
    items[index + step]?.type === 'transition' ? (items[index + step] as TransitionItem) : undefined;
  const neighbour = items[index + step * (there ? 2 : 1)];
  if (items[index]?.type !== 'clip' || neighbour?.type !== 'clip') return invalid('noCut');
  const made = make(there);
  const at = edge === 'end' ? index + 1 : index;
  const rest = there ? items.filter((item) => item !== there) : [...items];
  if (!made) return { ok: true, timeline: there ? withV1(timeline, rest) : timeline };
  const position = there && edge === 'start' ? at - 1 : at;
  return {
    ok: true,
    timeline: withV1(timeline, [...rest.slice(0, position), made, ...rest.slice(position)]),
  };
}

export function createFakeEditorOps(timelines: FakeTimelines): AnyCommand[] {
  const base = { sideEffect: 'write' as const, project: (p: { projectId: ProjectId }) => p.projectId };
  /** Writes an edit with the inverse that puts the tracks, captions, grade, music and mix back as they were. */
  const run = (
    payload: { projectId: ProjectId; timelineId: TimelineId },
    apply: (timeline: Timeline) => Edit,
    itemId?: string,
  ) => {
    const before = timelines.get(payload.timelineId);
    if (!before)
      return {
        ok: false as const,
        error: timelineError('timeline.not_found', { timelineId: payload.timelineId }),
      };
    const written = timelines.write(payload.projectId, before, apply(before), {
      name: 'timeline.restore',
      payload: {
        projectId: payload.projectId,
        timelineId: before.id,
        tracks: before.tracks,
        markers: before.markers,
        cast: before.cast,
        captions: before.captions,
        music: before.music,
        mix: before.mix,
        grade: before.grade ?? null,
      },
    });
    if (!written.ok || !itemId) return written;
    return { ...written, value: { ...written.value, result: { ...written.value.result, itemId } } };
  };
  return [
    defineCommand({
      ...base,
      name: EDITOR_COMMANDS.splitClip,
      payload: P[EDITOR_COMMANDS.splitClip],
      handle: (p) => {
        const id = newId<'TimelineItem'>();
        const at = RationalTime.rescale(
          p.at,
          timelines.get(p.timelineId)?.canvas.rate ?? p.at.rate,
          'round',
        ).value;
        return run(p, (timeline) => split(timeline, p.clipId, at, id), id);
      },
    }),
    defineCommand({
      ...base,
      name: EDITOR_COMMANDS.deleteClip,
      payload: P[EDITOR_COMMANDS.deleteClip],
      handle: (p) => run(p, (timeline) => rippleDelete(timeline, p.clipId)),
    }),
    defineCommand({
      ...base,
      name: EDITOR_COMMANDS.setSpeed,
      payload: P[EDITOR_COMMANDS.setSpeed],
      handle: (p) => run(p, (timeline) => setSpeed(timeline, { clipId: p.clipId, speed: p.speed })),
    }),
    defineCommand({
      ...base,
      name: EDITOR_COMMANDS.setTransition,
      payload: P[EDITOR_COMMANDS.setTransition],
      handle: (p) => {
        const id = newId<'TimelineItem'>();
        return run(
          p,
          (timeline) =>
            transitionAt(timeline, p.clipId, p.edge, (existing) => {
              const rate = timeline.canvas.rate;
              const total = p.duration
                ? RationalTime.rescale(p.duration, rate, 'round').value
                : Math.round((rate.num / rate.den) * 0.5);
              return {
                type: 'transition',
                id: existing?.id ?? (id as TransitionItem['id']),
                kind: p.kind,
                direction: p.kind === 'whip' || p.kind === 'slide' || p.kind === 'zoom' ? p.direction : null,
                inOffset: RationalTime.of(Math.floor(total / 2), rate),
                outOffset: RationalTime.of(total - Math.floor(total / 2), rate),
              };
            }),
          id,
        );
      },
    }),
    defineCommand({
      ...base,
      name: EDITOR_COMMANDS.removeTransition,
      payload: P[EDITOR_COMMANDS.removeTransition],
      handle: (p) =>
        run(p, (timeline) => {
          if (p.clipId) return transitionAt(timeline, p.clipId, p.edge, () => null);
          const items = v1(timeline);
          return items.some((item) => item.id === p.transitionId)
            ? {
                ok: true,
                timeline: withV1(
                  timeline,
                  items.filter((item) => item.id !== p.transitionId),
                ),
              }
            : notFound(p.transitionId ?? '');
        }),
    }),
    defineCommand({
      ...base,
      name: EDITOR_COMMANDS.setGrade,
      payload: P[EDITOR_COMMANDS.setGrade],
      handle: (p) =>
        run(p, (timeline) => {
          const merged = (was: Timeline['grade']) => {
            if (p.grade === null) return undefined;
            const next = {
              exposure: 0,
              contrast: 0,
              saturation: 0,
              temperature: 0,
              tint: 0,
              look: null,
              lookStrength: 1,
              ...was,
              ...p.grade,
            };
            return isNeutralGrade(next) ? undefined : next;
          };
          if (p.target.kind === 'timeline') {
            const { grade: _was, ...rest } = timeline;
            const next = merged(timeline.grade);
            return { ok: true, timeline: next ? { ...rest, grade: next } : rest };
          }
          const ids = new Set<string>(p.target.clipIds);
          const items = v1(timeline).map((item) => {
            if (item.type !== 'clip' || !ids.has(item.id)) return item;
            const { grade: _was, ...rest } = item;
            const next = merged(item.grade);
            return next ? { ...rest, grade: next } : rest;
          });
          return { ok: true, timeline: withV1(timeline, items) };
        }),
    }),
    defineCommand({
      ...base,
      name: AUDIO_EDIT_COMMANDS.setVolume,
      payload: editorCommandPayloads[AUDIO_EDIT_COMMANDS.setVolume],
      handle: (p) =>
        run(p, (timeline) => {
          if (p.target.kind !== 'clips') return invalid('fakeClipsOnly');
          const ids = new Set<string>(p.target.clipIds);
          const rate = timeline.canvas.rate;
          const fade = (time: RationalTime | undefined, length: number) =>
            time ? Math.min(length, RationalTime.rescale(time, rate, 'round').value) : undefined;
          const items = v1(timeline).map((item) => {
            if (item.type !== 'clip' || !ids.has(item.id)) return item;
            const gain = p.gainDb ?? item.audio.gainDb + (p.byDb ?? 0);
            const audio: Clip['audio'] = {
              ...item.audio,
              gainDb: Math.max(-60, Math.min(12, gain)),
              muted: p.muted ?? item.audio.muted,
            };
            for (const key of ['fadeIn', 'fadeOut'] as const) {
              const value = fade(p[key], item.duration.value);
              if (value === undefined) continue;
              if (value === 0) delete audio[key];
              else audio[key] = RationalTime.of(value, rate);
            }
            return { ...item, audio };
          });
          return { ok: true, timeline: withV1(timeline, items) };
        }),
    }),
  ];
}
