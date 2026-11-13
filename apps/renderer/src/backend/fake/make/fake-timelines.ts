// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `appContract.timelines` and the timeline commands as the fake serves them
 * (P2-M3, P2-M7): every edit is a command whose inverse is the internal
 * `timeline.restore` with the parts as they were, so ⌘Z undoes an edit and
 * its re-sync together; a no-op writes nothing and leaves no undo step.
 * `music.choosePath` and `captions.setEnabled` live on the document too.
 * Each write bumps the revision and is a `library.changed` for the timeline,
 * which `watch` and the pages follow.
 */
import {
  CAPTION_COMMANDS,
  captionCommandPayloads,
  defineCommand,
  err,
  MUSIC_COMMANDS,
  musicCommandPayloads,
  ok,
  PERSON_SOURCES,
  TIMELINE_COMMANDS,
  timelineCommandPayloads,
  timelineSchema,
  type AnyCommand,
  type CastCandidate,
  type Clip,
  type EventBus,
  type FindAlternatesInput,
  type ProjectId,
  type Timeline,
  type TimelineId,
  type TimelineSummary,
} from '@taalcut/core';
import { watched, type Watched } from '../watch';
import { editText, lockClip, moveClip, swapClip, timelineError, trimClip, type Edit } from './edits';
import type { PoolShot } from './shot-pool';

const P = timelineCommandPayloads;

export interface FakeTimelinesInput {
  readonly timelines: readonly Timeline[];
  readonly shots: ReadonlyMap<string, PoolShot>;
  readonly pools: ReadonlyMap<TimelineId, readonly PoolShot[]>;
}

export function summaryOf(timeline: Timeline): TimelineSummary {
  const clips = timeline.tracks[0]!.items.filter((item) => item.type === 'clip');
  const frames = timeline.tracks[0]!.items.reduce(
    (sum, item) => sum + (item.type === 'transition' ? 0 : item.duration.value),
    0,
  );
  return {
    id: timeline.id,
    projectId: timeline.projectId,
    name: timeline.name,
    revision: timeline.revision,
    duration: { value: frames, rate: timeline.canvas.rate },
    clipCount: clips.length,
    template: timeline.template,
    castId: timeline.cast?.castId ?? null,
    variantIndex: timeline.cast?.variantIndex ?? null,
    updatedAt: timeline.updatedAt,
  };
}

export function createFakeTimelines(events: EventBus, input: FakeTimelinesInput) {
  const docs = new Map<TimelineId, Timeline>(input.timelines.map((timeline) => [timeline.id, timeline]));
  const watchers = new Map<TimelineId, Watched<Timeline | undefined>>();
  const watcher = (id: TimelineId) => {
    let found = watchers.get(id);
    if (!found) {
      found = watched(() => docs.get(id));
      watchers.set(id, found);
    }
    return found;
  };
  const shotOf = (clip: Clip) =>
    clip.media.kind === 'video' ? input.shots.get(clip.media.shotId ?? clip.media.assetId) : undefined;

  /** Stores an edited document as the next revision; the inverse puts the parts back (or `inverse`). */
  function write(
    projectId: ProjectId,
    before: Timeline,
    edit: Edit,
    inverse?: { readonly name: string; readonly payload: unknown },
  ) {
    if (!edit.ok) return err(edit.error);
    const result = { timelineId: before.id, revision: before.revision };
    if (edit.timeline === before) return ok({ result });
    const next: Timeline = { ...edit.timeline, revision: before.revision + 1, updatedAt: Date.now() };
    const checked = timelineSchema.safeParse(next);
    if (!checked.success)
      return err(timelineError('timeline.invalid_move', { detail: checked.error.issues[0]?.message ?? '' }));
    docs.set(before.id, next);
    watcher(before.id).notify();
    events.emit('library.changed', { projectId, entity: 'timeline', change: 'updated', ids: [before.id] });
    return ok({
      result: { timelineId: before.id, revision: next.revision },
      inverse: inverse ?? {
        name: TIMELINE_COMMANDS.restore,
        payload: {
          projectId,
          timelineId: before.id,
          tracks: before.tracks,
          markers: before.markers,
          cast: before.cast,
          beatMap: before.beatMap,
          captions: before.captions,
        },
      },
    });
  }

  /** Runs `apply` on the payload's timeline and stores what it made. */
  function edited(
    payload: { readonly projectId: ProjectId; readonly timelineId: TimelineId },
    apply: (timeline: Timeline) => Edit,
  ) {
    const before = docs.get(payload.timelineId);
    if (!before) return err(timelineError('timeline.not_found', { timelineId: payload.timelineId }));
    return write(payload.projectId, before, apply(before));
  }
  const base = { sideEffect: 'write' as const, project: (p: { projectId: ProjectId }) => p.projectId };

  const commands: AnyCommand[] = [
    defineCommand({
      ...base,
      name: TIMELINE_COMMANDS.swapClip,
      payload: P[TIMELINE_COMMANDS.swapClip],
      handle: (p, context) =>
        edited(p, (timeline) =>
          swapClip(
            timeline,
            {
              clipId: p.clipId,
              shot: input.shots.get(p.media.shotId ?? p.media.assetId),
              sourceStart: p.sourceStart,
            },
            context.source,
          ),
        ),
    }),
    defineCommand({
      ...base,
      name: TIMELINE_COMMANDS.trimClip,
      payload: P[TIMELINE_COMMANDS.trimClip],
      handle: (p, context) => edited(p, (timeline) => trimClip(timeline, p, context.source)),
    }),
    defineCommand({
      ...base,
      name: TIMELINE_COMMANDS.moveClip,
      payload: P[TIMELINE_COMMANDS.moveClip],
      handle: (p, context) => edited(p, (timeline) => moveClip(timeline, p, context.source, shotOf)),
    }),
    defineCommand({
      ...base,
      name: TIMELINE_COMMANDS.editText,
      payload: P[TIMELINE_COMMANDS.editText],
      handle: (p, context) =>
        edited(p, (timeline) =>
          editText(
            timeline,
            {
              itemId: (p.itemId ?? p.edits?.[0]?.itemId ?? '') as never,
              text: p.text ?? p.edits?.[0]?.text ?? '',
            },
            context.source,
          ),
        ),
    }),
    defineCommand({
      ...base,
      name: TIMELINE_COMMANDS.moveText,
      payload: P[TIMELINE_COMMANDS.moveText],
      handle: (p, context) =>
        edited(p, (timeline) => {
          let found = false;
          const targetId = p.itemId ?? p.itemIds?.[0] ?? p.moves?.[0]?.itemId ?? '';
          const tracks = timeline.tracks.map((track) =>
            track.kind !== 'text'
              ? track
              : {
                  ...track,
                  items: track.items.map((item) => {
                    // Text only: a motion graphic (Timeline v2) moves by its placement.
                    if (item.id !== targetId || item.type !== 'text') return item;
                    found = true;
                    return {
                      ...item,
                      box: p.box,
                      origin: context.source === 'agent' ? ('editor' as const) : ('user' as const),
                    };
                  }),
                },
          );
          return found
            ? { ok: true, timeline: { ...timeline, tracks } }
            : { ok: false, error: timelineError('timeline.item_not_found', { itemId: targetId }) };
        }),
    }),
    defineCommand({
      ...base,
      name: TIMELINE_COMMANDS.lockClip,
      payload: P[TIMELINE_COMMANDS.lockClip],
      handle: (p) => edited(p, (timeline) => lockClip(timeline, p)),
    }),
    // The inverse of every edit, with the caption track an edit moves or clamps.
    defineCommand({
      name: TIMELINE_COMMANDS.restore,
      payload: P[TIMELINE_COMMANDS.restore],
      ...base,
      internal: true,
      handle: (p) => {
        const { projectId: _projectId, timelineId: _timelineId, grade, covers, ...parts } = p;
        return edited(p, (timeline) => {
          const restored = { ...timeline, ...strip(parts) };
          // EDT1-OPS: the whole video's grade as it was; null when it had none.
          if (covers === null) delete restored.covers;
          else if (covers !== undefined) restored.covers = covers;
          if (grade === null) delete restored.grade;
          else if (grade !== undefined) restored.grade = grade;
          return { ok: true, timeline: restored };
        });
      },
    }),
    defineCommand({
      name: MUSIC_COMMANDS.choosePath,
      payload: musicCommandPayloads[MUSIC_COMMANDS.choosePath],
      sideEffect: 'write',
      project: (p) => p.projectId,
      handle: (p, context) => {
        const before = docs.get(p.timelineId);
        if (!before) return err(timelineError('timeline.not_found', { timelineId: p.timelineId }));
        if (p.acknowledgedAt !== undefined && !(PERSON_SOURCES as readonly string[]).includes(context.source))
          return err({
            code: 'core.command_source_refused',
            messageKey: 'errors.core.command_source_refused',
            retryable: false,
          });
        // REF1: the reel's music needs no "I understand" any more; it is the default.
        if (JSON.stringify(before.music) === JSON.stringify(p.choice))
          return ok({ result: { timelineId: before.id, revision: before.revision } });
        return write(
          p.projectId,
          before,
          { ok: true, timeline: { ...before, music: p.choice } },
          {
            name: MUSIC_COMMANDS.choosePath,
            payload: { projectId: p.projectId, timelineId: before.id, choice: before.music },
          },
        );
      },
    }),
    defineCommand({
      name: CAPTION_COMMANDS.setEnabled,
      payload: captionCommandPayloads[CAPTION_COMMANDS.setEnabled],
      sideEffect: 'write',
      project: (p) => p.projectId,
      handle: (p) => {
        const before = docs.get(p.timelineId);
        if (!before) return err(timelineError('timeline.not_found', { timelineId: p.timelineId }));
        if (!before.captions) return err(timelineError('timeline.invalid_move', { reason: 'noCaptions' }));
        if (before.captions.enabled === p.enabled)
          return ok({ result: { timelineId: before.id, revision: before.revision } });
        return write(
          p.projectId,
          before,
          { ok: true, timeline: { ...before, captions: { ...before.captions, enabled: p.enabled } } },
          {
            name: CAPTION_COMMANDS.setEnabled,
            payload: { projectId: p.projectId, timelineId: before.id, enabled: before.captions.enabled },
          },
        );
      },
    }),
    // A QA fix's command: move or resize the captions. Its inverse puts the whole style back.
    defineCommand({
      ...base,
      name: CAPTION_COMMANDS.setStyle,
      payload: captionCommandPayloads[CAPTION_COMMANDS.setStyle],
      handle: (p) => {
        const before = docs.get(p.timelineId);
        if (!before?.captions) return err(timelineError('timeline.not_found', { timelineId: p.timelineId }));
        const { version: _version, ...style } = before.captions.style;
        return write(
          p.projectId,
          before,
          {
            ok: true,
            timeline: {
              ...before,
              captions: {
                ...before.captions,
                style: { ...before.captions.style, ...p.style },
                styleSource: 'user',
              },
            },
          },
          {
            name: CAPTION_COMMANDS.setStyle,
            payload: { projectId: p.projectId, timelineId: before.id, style },
          },
        );
      },
    }),
  ];

  return {
    commands,
    addCreation(timeline: Timeline) {
      docs.set(timeline.id, timeline);
      watcher(timeline.id).notify();
      events.emit('library.changed', {
        projectId: timeline.projectId,
        entity: 'timeline',
        change: 'updated',
        ids: [timeline.id],
      });
    },
    /** Phase 3's commands (make/p3/*) edit through here, so every write is a new revision, announced, undoable. */
    edit: edited,
    write,
    get: (id: TimelineId) => docs.get(id),
    all: () => [...docs.values()],
    listByProject: (projectId: ProjectId) =>
      [...docs.values()].filter((timeline) => timeline.projectId === projectId).map(summaryOf),
    /** The current document first, then every new revision; ends when the timeline is gone. */
    async *watch(id: TimelineId, signal?: AbortSignal): AsyncGenerator<Timeline> {
      for await (const timeline of watcher(id).stream(signal)) {
        if (!timeline) return;
        yield timeline;
      }
    },
    /** Replaces a document wholesale (a restored version): a new revision, announced. */
    replace(projectId: ProjectId, next: Timeline) {
      const before = docs.get(next.id);
      if (!before) return;
      docs.set(next.id, { ...next, revision: before.revision + 1, updatedAt: Date.now() });
      watcher(next.id).notify();
      events.emit('library.changed', { projectId, entity: 'timeline', change: 'updated', ids: [next.id] });
    },
    findAlternates(query: FindAlternatesInput): CastCandidate[] {
      const timeline = docs.get(query.timelineId);
      const pool = input.pools.get(query.timelineId) ?? [];
      if (!timeline) return [];
      const used = new Set<string>();
      for (const slot of timeline.cast?.slots ?? []) {
        if (slot.pick?.shotId) used.add(slot.pick.shotId);
        if (slot.slotId === query.slotId)
          for (const alt of slot.alternates) if (alt.shotId) used.add(alt.shotId);
      }
      for (const id of query.exclude) used.add(id);
      // The pool's tail, which the cast didn't use: fresh candidates, best first.
      return pool
        .map((shot) => shot.candidate)
        .filter((candidate) => candidate.shotId !== null && !used.has(candidate.shotId))
        .slice(-24)
        .sort((a, b) => b.score - a.score)
        .slice(0, query.limit);
    },
  };
}

/** Drops parts the restore didn't carry. */
function strip<T extends object>(parts: T): Partial<T> {
  return Object.fromEntries(Object.entries(parts).filter(([, value]) => value !== undefined)) as Partial<T>;
}

export type FakeTimelines = ReturnType<typeof createFakeTimelines>;
