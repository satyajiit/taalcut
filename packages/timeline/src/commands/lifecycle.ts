// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.create (one step for every variant) and its inverse
 * timeline.discard, timeline.restore (every edit's inverse), and
 * music.choosePath, whose choice lives on the timeline (render SPEC 8). Since
 * REF1 the reel's own music needs no acknowledgement; it must be the
 * timeline's own template's reel, whose beat map the cuts follow.
 */
import {
  defineCommand,
  err,
  MUSIC_COMMANDS,
  musicCommandPayloads,
  NotImplementedError,
  ok,
  TIMELINE_COMMANDS,
  timelineCommandPayloads as payloads,
  ValidationError,
  type MusicChoice,
  type Timeline,
} from '@taalcut/core';
import type { TimelinePart } from '../edits/types';
import { InvalidMove } from '../errors';
import { rampProblems } from '../model/validate';
import { withMusic } from '../resync/music-beats';
import {
  commit,
  noteTimelines,
  readFor,
  restoredTimeline,
  restorePayload,
  writeEdit,
  type CommandDeps,
} from './context';

export function createLifecycleCommands(deps: CommandDeps) {
  const create = defineCommand({
    name: TIMELINE_COMMANDS.create,
    payload: payloads[TIMELINE_COMMANDS.create],
    sideEffect: 'write',
    handle: async (payload, context) => {
      const timelineIds = payload.timelines.map((timeline) => timeline.id);
      for (const timeline of payload.timelines) {
        if (timeline.projectId !== payload.projectId) return err(ValidationError({ field: 'projectId' }));
        const ramps = rampProblems(timeline);
        if (ramps.length > 0) return err(InvalidMove(undefined, { detail: ramps.join('; ') }));
      }
      for (const timeline of payload.timelines) {
        const created = await deps.store.create(timeline, context);
        if (!created.ok) return created;
      }
      noteTimelines(deps, context, { projectId: payload.projectId, change: 'created', ids: timelineIds });
      return ok({
        result: { timelineIds },
        inverse: { name: TIMELINE_COMMANDS.discard, payload: { projectId: payload.projectId, timelineIds } },
      });
    },
  });

  const discard = defineCommand({
    name: TIMELINE_COMMANDS.discard,
    payload: payloads[TIMELINE_COMMANDS.discard],
    sideEffect: 'write',
    internal: true,
    handle: async (payload, context) => {
      const timelines: Timeline[] = [];
      for (const timelineId of payload.timelineIds) {
        const current = await readFor(deps.store, timelineId, payload.projectId);
        if (!current.ok) return current;
        timelines.push(current.value);
      }
      for (const timeline of timelines) {
        const removed = await deps.store.remove(timeline.id, context);
        if (!removed.ok) return removed;
      }
      noteTimelines(deps, context, { projectId: payload.projectId, change: 'deleted', ids: payload.timelineIds });
      return ok({
        result: { timelineIds: payload.timelineIds },
        inverse: { name: TIMELINE_COMMANDS.create, payload: { projectId: payload.projectId, timelines } },
      });
    },
  });

  const restore = defineCommand({
    name: TIMELINE_COMMANDS.restore,
    payload: payloads[TIMELINE_COMMANDS.restore],
    sideEffect: 'write',
    internal: true,
    handle: async (payload, context) => {
      // The energy curve's undo moves the template's head back in the same unit of work.
      if (payload.templateHead) {
        if (!deps.templateStore) return err(NotImplementedError({ feature: 'timeline.templateHead' }));
        const moved = await deps.templateStore.setHead(payload.templateHead, context);
        if (!moved.ok) return moved;
      }
      return writeEdit(deps, payload, context, (timeline) => ok(restoredTimeline(timeline, payload)));
    },
  });

  const choosePath = defineCommand({
    name: MUSIC_COMMANDS.choosePath,
    payload: musicCommandPayloads[MUSIC_COMMANDS.choosePath],
    sideEffect: 'write',
    // `acknowledgedAt` (core's payload) is ignored since REF1: there is nothing to acknowledge.
    handle: async (payload, context) => {
      const current = await readFor(deps.store, payload.timelineId, payload.projectId);
      if (!current.ok) return current;
      const foreign = foreignReel(current.value, payload.choice);
      if (foreign) return err(foreign);
      const result = { timelineId: current.value.id, revision: current.value.revision };
      if (JSON.stringify(current.value.music) === JSON.stringify(payload.choice)) return ok({ result });
      // Path b: the cuts follow the user's own track; path d: back on the reel's beats if a track moved them. One
      // undo puts back the choice and the cuts together.
      const chosen = await withMusic(current.value, payload.choice, {
        ...(deps.trackBeats ? { trackBeats: deps.trackBeats } : {}),
        ...(deps.templates ? { templates: deps.templates } : {}),
        ...(deps.config ? { config: deps.config } : {}),
        ...(deps.ids ? { ids: deps.ids } : {}),
      });
      if (!chosen.ok) return chosen;
      const changed: TimelinePart[] = chosen.value.retimed ? ['music', 'tracks', 'markers', 'beatMap'] : ['music'];
      const written = await commit(deps, current.value, chosen.value.timeline, context);
      if (!written.ok) return written;
      return ok({
        result: { timelineId: written.value.id, revision: written.value.revision },
        inverse: { name: TIMELINE_COMMANDS.restore, payload: restorePayload(current.value, changed) },
      });
    },
  });

  return { create, discard, restore, choosePath, all: [create, discard, restore, choosePath] };
}

/**
 * The reel's music plays from frame 0 on its template's beat map, so it must be this timeline's template's reel:
 * another template's, or one on a timeline made without a template, would never be on the cuts.
 */
function foreignReel(timeline: Timeline, choice: MusicChoice) {
  if (choice.path !== 'referenceAudio' || choice.templateId === timeline.template?.id) return null;
  return ValidationError(
    { field: 'choice.templateId' },
    { detail: "the reel's music must be the timeline's own template's" },
  );
}
