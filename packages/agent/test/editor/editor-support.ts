// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CTX's stand-ins: the timestamp fixtures' timeline in a store a trim tool changes, an Editor skill shaped like
 * timeline's (it hands off the timeline at its revision and makes a timeline card), the editor resolver over the
 * store, and the editor context the docked composer would send.
 */
import {
  defineSkill,
  defineSkillModule,
  defineTool,
  defineToolModule,
  NO_TOOL_RETRY,
  NotFoundError,
  err,
  ok,
  unwrap,
  ULID_PATTERN,
  type EditTarget,
  type EditorContext,
  type RationalTime,
  type Timeline,
  type TimelineId,
  type TimelineItemId,
  type ToolModule,
} from '@taalcut/core';
import { createEditorResolver, createSkillRegistry } from '@taalcut/agent';
import { z } from 'zod';
import { harness, registryFor } from '../support/harness';
import type { ModelScript } from '@taalcut/agent';
import { videos } from '../timestamps/videos';

const ulid = z.string().regex(ULID_PATTERN);

export function editorWorld() {
  const v = videos();
  const timelines = new Map<string, Timeline>([[v.timeline.id, v.timeline]]);
  const read = async (timelineId: TimelineId) => {
    const timeline = timelines.get(timelineId);
    return timeline ? ok(timeline) : err(NotFoundError({ entity: 'timeline', id: timelineId }));
  };
  /** Takes `frames` off a clip's end, as timeline.trimClip would. */
  const trim = (timelineId: string, clipId: string, frames: number) => {
    const timeline = timelines.get(timelineId)!;
    const tracks = timeline.tracks.map((track) =>
      track.kind !== 'video'
        ? track
        : {
            ...track,
            items: track.items.map((item) =>
              item.id === clipId && item.type === 'clip'
                ? { ...item, duration: { ...item.duration, value: item.duration.value - frames } }
                : item,
            ),
          },
    );
    timelines.set(timelineId, { ...timeline, tracks, revision: timeline.revision + 1 });
  };
  /** EDT1-OPS: what each write tool call saw as ctx.editor (the docked run's brief). */
  const toolEditors: unknown[] = [];
  return { v, timelines, read, trim, toolEditors, resolver: createEditorResolver({ timeline: read }) };
}

export type EditorWorld = ReturnType<typeof editorWorld>;

function tools(world: EditorWorld): ToolModule {
  const local = { costClass: 'local' as const, timeoutMs: 1_000, retry: NO_TOOL_RETRY };
  return defineToolModule({
    id: 'timeline',
    tools: [
      defineTool({
        name: 'timeline.get',
        version: '1.0.0',
        description: 'Reads a timeline.',
        input: z.object({ timelineId: ulid }),
        output: z.object({ revision: z.int() }),
        sideEffect: 'read',
        ...local,
        run: async ({ timelineId }) => ok({ revision: world.timelines.get(timelineId)?.revision ?? 0 }),
      }),
      defineTool({
        name: 'timeline.trimClip',
        version: '1.0.0',
        description: "Takes frames off a clip's end.",
        input: z.object({ timelineId: ulid, clipId: ulid, frames: z.int().min(1).max(300) }),
        output: z.object({ revision: z.int() }),
        sideEffect: 'write',
        ...local,
        command: 'timeline.trimClip',
        idempotencyKey: (value) => JSON.stringify(value),
        run: async (value, ctx) => {
          world.toolEditors.push(ctx.editor);
          const done = await ctx.dispatch(value);
          if (!done.ok) return done;
          world.trim(value.timelineId, value.clipId, value.frames);
          return ok({ revision: world.timelines.get(value.timelineId)!.revision });
        },
      }),
    ],
  });
}

function editorSkill(world: EditorWorld) {
  return defineSkill({
    id: 'timeline.editor',
    version: '1.0.0',
    labelKey: 'skills.timeline.editor',
    description: 'Edits a timeline.',
    prompt: 'Make the change with the timeline tools, then hand off the timeline at its revision.',
    tools: { names: ['timeline.get', 'timeline.trimClip'] },
    input: z.object({
      projectId: ulid,
      timelineId: ulid,
      templateId: ulid,
      request: z.string().optional(),
      targets: z.array(z.unknown()).optional(),
      context: z.unknown().optional(),
    }),
    output: z.object({
      timelineId: ulid,
      revision: z.int().min(1),
      notExportedReason: z.string().trim().min(1).optional(),
      notSavedCoverReason: z.string().trim().min(1).optional(),
      notStagedReason: z.string().trim().min(1).optional(),
      postCaption: z.string().optional(),
    }),
    refs: (out) => [{ entity: 'timeline', id: out.timelineId, version: out.revision }],
    verify: async () => ok({ verdict: 'pass' }),
    card: async (out, ctx) => {
      const timeline = world.timelines.get(out.timelineId)!;
      return ok({
        type: 'timeline',
        id: 'editor-own-id',
        version: 1,
        runId: ctx.runId,
        projectId: timeline.projectId,
        timelineId: timeline.id,
        revision: timeline.revision,
        duration: { value: 300, rate: timeline.canvas.rate },
        clipCount: 5,
      });
    },
  });
}

/** An agent with the Editor and the editor resolver composed in. */
export function editorHarness(world: EditorWorld, script: ModelScript, options: { resolver?: boolean } = {}) {
  const modules = [tools(world)];
  const skills = unwrap(
    createSkillRegistry(
      [defineSkillModule({ id: 'timeline', skills: [editorSkill(world)] })],
      registryFor(modules),
    ),
  );
  return harness({
    script,
    modules,
    deps: { skills, phase3: options.resolver === false ? {} : { editor: world.resolver } },
  });
}

const zero = (timeline: Timeline, frames = 0): RationalTime => ({
  value: frames,
  rate: timeline.canvas.rate,
});

/** What the docked composer sends: the timeline on screen, the playhead and the selection. */
export function contextOf(
  world: EditorWorld,
  options: { selection?: readonly TimelineItemId[]; playhead?: number } = {},
): EditorContext {
  const timeline = world.v.timeline;
  const selection: EditTarget[] = (options.selection ?? []).map((itemId) => ({
    kind: 'item',
    timelineId: timeline.id,
    itemId,
    itemKind: 'clip',
  }));
  return {
    timelineId: timeline.id,
    revision: timeline.revision,
    playhead: zero(timeline, options.playhead),
    selection,
  };
}
