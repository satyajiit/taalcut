// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MORE1: the three edits the More tab's dialogs end in, as the fake runs them, kept small and only with
 * `{ "more": "commands" }` in `taalcut.fake` (options/more.ts): timeline.freezeFrame (the scene is cut at the
 * moment and a held frame of the asked length goes in between; what follows moves to make room),
 * timeline.setHoldDuration (a held frame's length, what follows moving with it) and timeline.makeSize (an
 * independent copy of the video at another shape). The real timeline also follows a speed ramp to the frame it
 * holds and re-fits transitions; the fake does neither.
 */
import {
  defineCommand,
  err,
  newId,
  ok,
  RationalTime,
  SIMPLE_EDITOR_COMMANDS as N,
  simpleEditorPayloads as P,
  VIDEO_SIZES,
  type AnyCommand,
  type Clip,
  type EventBus,
  type ProjectId,
  type Timeline,
  type TimelineId,
  type TimelineItemId,
} from '@taalcut/core';
import { timelineError, type Edit } from './edits';
import { shiftAfter, startOf, v1, withV1 } from './fake-editor-ops';
import type { FakeTimelines } from './fake-timelines';

const refused = (code: string, params: Record<string, string>): Edit => ({
  ok: false,
  error: timelineError(code, params),
});

/** The scene with this id on the video track, and where it starts. */
function sceneOf(timeline: Timeline, clipId: string) {
  const items = v1(timeline);
  const index = items.findIndex((item) => item.id === clipId);
  const clip = items[index];
  return clip?.type === 'clip' ? { items, index, clip, start: startOf(items, index) } : null;
}

function freeze(
  timeline: Timeline,
  input: { clipId: string; at: number; frames: number },
  ids: { hold: TimelineItemId; rest: TimelineItemId },
): Edit {
  const found = sceneOf(timeline, input.clipId);
  if (!found) return refused('timeline.item_not_found', { itemId: input.clipId });
  const { items, index, clip, start } = found;
  if (clip.locked) return refused('timeline.clip_locked', { clipId: clip.id });
  const offset = input.at - start;
  if (clip.media.kind !== 'video' || offset < 0 || offset >= clip.duration.value || input.frames < 1)
    return refused('timeline.invalid_move', { reason: 'outside' });
  const rate = timeline.canvas.rate;
  const media = clip.sourceStart.rate;
  // The file's frame on show at that moment (a held scene shows the one it holds).
  const into = Math.floor(((offset * rate.den) / rate.num) * (media.num / media.den) + 1e-9);
  const frame = clip.holdFrame ?? RationalTime.of(clip.sourceStart.value + into, media);
  const loose = { slotId: null, syncPoint: null, beatAnchor: null };
  const hold: Clip = {
    ...clip,
    ...loose,
    id: ids.hold,
    sourceStart: frame,
    holdFrame: frame,
    duration: RationalTime.of(input.frames, rate),
    speed: null,
    audio: { ...clip.audio, gainDb: 0, muted: true },
  };
  const parts: Clip[] =
    offset === 0
      ? [hold, clip]
      : [
          { ...clip, duration: RationalTime.of(offset, rate) },
          hold,
          {
            ...clip,
            ...loose,
            id: ids.rest,
            duration: RationalTime.of(clip.duration.value - offset, rate),
            sourceStart: clip.holdFrame
              ? clip.sourceStart
              : RationalTime.of(clip.sourceStart.value + into, media),
          },
        ];
  const next = withV1(timeline, [...items.slice(0, index), ...parts, ...items.slice(index + 1)]);
  return { ok: true, timeline: shiftAfter(next, input.at, input.frames) };
}

function holdLength(timeline: Timeline, input: { clipId: string; frames: number }): Edit {
  const found = sceneOf(timeline, input.clipId);
  if (!found) return refused('timeline.item_not_found', { itemId: input.clipId });
  const { items, index, clip, start } = found;
  if (clip.locked) return refused('timeline.clip_locked', { clipId: clip.id });
  if (!clip.holdFrame || input.frames < 1) return refused('timeline.invalid_move', { reason: 'notHeld' });
  const rate = timeline.canvas.rate;
  const next = withV1(timeline, [
    ...items.slice(0, index),
    { ...clip, duration: RationalTime.of(input.frames, rate) },
    ...items.slice(index + 1),
  ]);
  return {
    ok: true,
    timeline: shiftAfter(next, start + clip.duration.value, input.frames - clip.duration.value),
  };
}

export function createFakeMore(timelines: FakeTimelines, events: EventBus): AnyCommand[] {
  const base = { sideEffect: 'write' as const, project: (p: { projectId: ProjectId }) => p.projectId };
  const framesOf = (timelineId: TimelineId, time: RationalTime) => {
    const rate = timelines.get(timelineId)?.canvas.rate ?? time.rate;
    return RationalTime.rescale(time, rate, 'round').value;
  };
  return [
    defineCommand({
      ...base,
      name: N.freezeFrame,
      payload: P[N.freezeFrame],
      handle: (p) => {
        const ids = { hold: newId<'TimelineItem'>(), rest: newId<'TimelineItem'>() };
        const input = {
          clipId: p.clipId,
          at: framesOf(p.timelineId, p.at),
          frames: framesOf(p.timelineId, p.duration),
        };
        const written = timelines.edit(p, (timeline) => freeze(timeline, input, ids));
        if (!written.ok) return written;
        // The held moment is the item the editor selects next.
        const result = { ...written.value.result, itemId: ids.hold, affectedItemIds: [ids.hold] };
        return ok({ ...written.value, result });
      },
    }),
    defineCommand({
      ...base,
      name: N.setHoldDuration,
      payload: P[N.setHoldDuration],
      handle: (p) =>
        timelines.edit(p, (timeline) =>
          holdLength(timeline, { clipId: p.clipId, frames: framesOf(p.timelineId, p.duration) }),
        ),
    }),
    defineCommand({
      ...base,
      name: N.makeSize,
      payload: P[N.makeSize],
      handle: (p) => {
        const source = timelines.get(p.timelineId);
        if (!source) return err(timelineError('timeline.not_found', { timelineId: p.timelineId }));
        const id = newId<'Timeline'>();
        const now = Date.now();
        timelines.addCreation({
          ...structuredClone(source),
          id,
          name: `${source.name.slice(0, 185)} (${p.aspect})`,
          exportAtCanvasSize: true,
          canvas: { ...VIDEO_SIZES[p.aspect], rate: source.canvas.rate },
          revision: 1,
          createdAt: now,
          updatedAt: now,
        });
        // A new video: the editor reads the project's videos again, so the copy can be opened.
        events.emit('library.changed', {
          projectId: p.projectId,
          entity: 'timeline',
          change: 'created',
          ids: [id],
        });
        return ok({ result: { timelineId: id, revision: 1, affectedItemIds: [] } });
      },
    }),
  ];
}
