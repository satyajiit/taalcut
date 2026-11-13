// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the timestamp fixtures run on: an earlier run in the conversation whose flow made the template and the
 * timeline (in the memory log), the stores read through core's types, edit tools shaped like the timeline
 * lane's (they dispatch commands, so the test sees exactly what was asked), templates' `slotAt`, and the
 * reading of the "[Taalcut] The user pointed at:" note a scripted model acts on.
 */
import {
  defineTool,
  defineToolModule,
  err,
  newId,
  NO_TOOL_RETRY,
  NotFoundError,
  ok,
  rationalTimeJsonSchema,
  type RunId,
  type ToolModule,
} from '@taalcut/core';
import {
  createPointerResolver,
  newEvent,
  type EventLogStore,
  type ModelScript,
  type PointerResolver,
} from '@taalcut/agent';
import type { ModelRequest } from '@taalcut/models';
import { z } from 'zod';
import type { Videos } from './videos';

const T = 1_760_000_100_000;

/** A finished run that analysed a reference and cast the timeline: what a later message points into. */
export async function seedFlow(store: EventLogStore, v: Videos, at = T): Promise<RunId> {
  const runId = newId<'AgentRun'>();
  const flowId = newId<'Flow'>();
  const events = [
    newEvent(
      'run.started',
      {
        conversationId: 'c',
        message: 'Copy this reel with my morning clips',
        autonomy: 'autopilot',
        budget: {},
        localOnly: false,
        soulVersion: '1.0.0',
        catalogueHash: 'x',
      },
      at,
    ),
    newEvent(
      'flow.started',
      {
        flowId,
        path: 'reference',
        start: { path: 'reference', reference: { kind: 'file', path: '/Users/demo/reel.mp4' } },
        projectId: v.timeline.projectId,
        cardFlowId: flowId,
      },
      at + 1,
    ),
    newEvent(
      'skill.handedOff',
      {
        stepId: 'f1',
        skill: 'templates.analyst',
        version: '1.0.0',
        outputHash: 'a',
        refs: [{ entity: 'template', id: v.template.id, version: v.template.version }],
      },
      at + 2,
    ),
    newEvent(
      'skill.handedOff',
      {
        stepId: 'f2',
        skill: 'timeline.librarian',
        version: '1.0.0',
        outputHash: 'b',
        refs: [{ entity: 'timeline', id: v.timeline.id, version: v.timeline.revision }],
      },
      at + 3,
    ),
    newEvent('run.completed', { report: 'Made it.', did: [] }, at + 4),
  ];
  const appended = await store.append(runId, 0, events);
  if (!appended.ok) throw new Error(appended.error.code);
  return runId;
}

/** The resolver over the fixture's template and timeline, as the desktop builds it over the stores. */
export function resolverFor(v: Videos): PointerResolver {
  return createPointerResolver({
    template: async (id) =>
      id === v.template.id ? ok(v.template) : err(NotFoundError({ entity: 'template', id })),
    timeline: async (id) =>
      id === v.timeline.id ? ok(v.timeline) : err(NotFoundError({ entity: 'timeline', id })),
  });
}

const id = z.string().min(1).max(64);
const write = {
  costClass: 'local' as const,
  sideEffect: 'write' as const,
  timeoutMs: 1_000,
  retry: NO_TOOL_RETRY,
};

function edit<S extends z.ZodObject>(name: string, description: string, input: S) {
  return defineTool({
    name,
    version: '1.0.0',
    description,
    input,
    output: z.object({ done: z.boolean() }),
    ...write,
    command: name,
    idempotencyKey: (value) => JSON.stringify(value),
    run: async (value, ctx) => {
      const done = await ctx.dispatch(value);
      return done.ok ? ok({ done: true }) : done;
    },
  });
}

/** Edit tools on the user's timeline, named like the timeline lane's. */
export function timelineEdits(): ToolModule {
  return defineToolModule({
    id: 'timeline',
    tools: [
      edit(
        'timeline.setTransition',
        'Sets the transition into a clip.',
        z.object({ timelineId: id, clipId: id, kind: z.string().min(1).max(20) }),
      ),
      edit(
        'timeline.trimClip',
        "Trims one edge of a clip by a signed time at the canvas rate (positive lengthens), like core's payload.",
        z.object({ timelineId: id, clipId: id, edge: z.enum(['start', 'end']), by: rationalTimeJsonSchema }),
      ),
      edit(
        'timeline.adjustClip',
        "Changes a clip's brightness.",
        z.object({ timelineId: id, clipId: id, brightness: z.number().min(-1).max(1) }),
      ),
      edit(
        'timeline.swapClip',
        "Swaps a slot's clip for its next alternate.",
        z.object({ timelineId: id, slotId: id }),
      ),
      edit(
        'timeline.dropSlot',
        'Drops a slot; its neighbours take the time.',
        z.object({ timelineId: id, slotId: id }),
      ),
    ],
  });
}

/** Templates' read tool for one slot. */
export function templateReads(): ToolModule {
  return defineToolModule({
    id: 'templates',
    tools: [
      defineTool({
        name: 'templates.slotAt',
        version: '1.0.0',
        description:
          'Reads one slot of a template by its number: its range, intent and the transition into it.',
        input: z.object({ templateId: id, index: z.int().min(1).max(200) }),
        output: z.object({ index: z.int() }),
        costClass: 'local',
        sideEffect: 'read',
        timeoutMs: 1_000,
        retry: NO_TOOL_RETRY,
        run: async (value) => ok({ index: value.index }),
      }),
    ],
  });
}

/** One line of the note, as a model would read it. */
export interface NoteLine {
  readonly text: string;
  readonly basis: 'template' | 'timeline';
  readonly slotId?: string;
  readonly slotNumber?: number;
  readonly clipId?: string;
  readonly templateId?: string;
  readonly timelineId?: string;
  /** Template lines: the user's clip and timeline for that slot. */
  readonly theirClipId?: string;
  readonly theirTimelineId?: string;
  readonly found: boolean;
}

const grab = (text: string, pattern: RegExp) => pattern.exec(text)?.[1];

/** The note's lines in the request's messages; none when there is no note. */
export function noteLines(request: Pick<ModelRequest, 'messages'>): NoteLine[] {
  const note = request.messages
    .map((m) => (m.role === 'user' && typeof m.content === 'string' ? m.content : ''))
    .find((text) => text.startsWith('[Taalcut] The user pointed at:'));
  if (!note) return [];
  return note
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((text) => {
      const number = grab(text, /→ (?:the cut into |a range from )?slot (\d+)/);
      const fields = {
        slotId: grab(text, /slot id (\w+)/),
        clipId: grab(text, /; clip id (\w+)/),
        templateId: grab(text, /template (\w{26})/),
        timelineId: grab(text, /; timeline (\w{26})/),
        theirTimelineId: grab(text, /their timeline (\w{26})/),
        theirClipId: grab(text, /their timeline \w{26}, clip id (\w+)/),
      };
      return {
        text,
        basis: text.includes('of their video') ? ('timeline' as const) : ('template' as const),
        ...(number ? { slotNumber: Number(number) } : {}),
        ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
        found: text.includes('→'),
      };
    });
}

/** What the model does for a fixture, from the note's lines: one tool call, or a reply with none. */
export type Act = (
  lines: readonly NoteLine[],
) => { readonly tool: string; readonly args: Record<string, unknown> } | string;

/** Plan, load the tool, call it with the note's ids, then report; or, for an answer, plan and reply. */
export function actOnNote(act: Act): ModelScript {
  return (request, turn) => {
    if (turn === 0)
      return { toolCalls: [{ name: 'updatePlan', arguments: { steps: [{ text: 'Do what was asked' }] } }] };
    const action = act(noteLines(request));
    if (typeof action === 'string' || turn >= 3)
      return { text: typeof action === 'string' ? action : 'Done.' };
    if (turn === 1) return { toolCalls: [{ name: 'findTools', arguments: { query: action.tool } }] };
    return { toolCalls: [{ name: action.tool.replace('.', '_'), arguments: action.args }] };
  };
}
