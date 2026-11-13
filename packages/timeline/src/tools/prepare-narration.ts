// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ConflictError,
  defineCommand,
  defineTool,
  defineToolModule,
  err,
  NO_TOOL_RETRY,
  NotFoundError,
  ok,
  RationalTime,
  ulidSchema,
  upgradeTimeline,
  ValidationError,
  type EventBus,
  type TimelineStore,
} from '@taalcut/core';
import { z } from 'zod';

const name = 'timeline.prepareNarration';
const input = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  revision: z.int().positive(),
  frame: z.int().nonnegative().optional(),
});
const output = input.extend({ frame: z.int().nonnegative(), prepared: z.literal(true) });

/** Like hub.openShare: request a local panel, without permission prompts or microphone access. */
export function createPrepareNarration(deps: {
  timelines: Pick<TimelineStore, 'get'>;
  events: Pick<EventBus, 'emit'>;
}) {
  const command = defineCommand({
    name,
    payload: input,
    sideEffect: 'read',
    handle: async (request) => {
      const stored = await deps.timelines.get(request.timelineId);
      if (!stored.ok) return stored;
      const read = upgradeTimeline(stored.value.json, stored.value.schemaVersion);
      if (!read.ok) return read;
      const timeline = read.value;
      if (timeline.projectId !== request.projectId)
        return err(NotFoundError({ entity: 'timeline', id: request.timelineId }));
      if (timeline.revision !== request.revision)
        return err(ConflictError({ entity: 'timeline', id: timeline.id }));
      const frame = request.frame ?? 0;
      const total =
        timeline.tracks[0]?.items.reduce(
          (sum, item) => sum + (item.type === 'clip' || item.type === 'gap' ? item.duration.value : 0),
          0,
        ) ?? 0;
      if (frame >= total - 1) return err(ValidationError({ field: 'frame' }));
      deps.events.emit('ui.action', {
        action: name,
        args: {
          projectId: request.projectId,
          timelineId: request.timelineId,
          revision: String(request.revision),
          frame: String(frame),
        },
      });
      return ok({ result: { ...request, frame, prepared: true as const } });
    },
  });
  const tool = defineTool({
    name,
    command: name,
    version: '1.0.0',
    description:
      'Prepares the Sound recorder in the open editor for this project, at a frame of the revision you read. When frame is omitted, uses this request’s editor playhead, or frame zero outside an editor request. Only opens the panel and positions the playhead; never requests microphone permission or records. The person must press Record voice. Does not change the timeline.',
    summary: 'Prepares the recorder for the person to press Record voice.',
    tags: ['voice', 'narration', 'recording'],
    input,
    output,
    costClass: 'local',
    sideEffect: 'write',
    timeoutMs: 5000,
    retry: NO_TOOL_RETRY,
    permission: { network: 'none' },
    idempotencyKey: (request) =>
      `${request.projectId}:${request.timelineId}:${request.revision}:${request.frame ?? 'playhead'}`,
    run: async (request, context) => {
      const editor = context.editor?.context;
      let frame = request.frame ?? 0;
      if (request.frame === undefined && editor?.timelineId === request.timelineId) {
        const stored = await deps.timelines.get(request.timelineId);
        if (!stored.ok) return stored;
        const timeline = upgradeTimeline(stored.value.json, stored.value.schemaVersion);
        if (!timeline.ok) return timeline;
        frame = RationalTime.toFrames(editor.playhead, timeline.value.canvas.rate);
      }
      const done = await context.dispatch({ ...request, frame });
      return done.ok ? ok(output.parse(done.value)) : done;
    },
  });
  return { command, tools: defineToolModule({ id: 'timeline', tools: [tool] }) };
}
