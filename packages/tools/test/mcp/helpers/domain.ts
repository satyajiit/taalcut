// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A small make-flow stand-in for the MCP tests: a reference breakdown (read), a clip swap that dispatches an
 * undoable command (write), a render export (checkpoint), a destructive slot clear, a paid cloud call, the
 * sandbox family (hidden) and a tool that opts out of MCP. Real core commands on a real bus, so audit rows,
 * sources and undo are the bus's own.
 */
import {
  defineCommand,
  defineTool,
  defineToolModule,
  idSchema,
  NO_TOOL_RETRY,
  ok,
  ulidSchema,
  type AnyCommand,
  type ToolModule,
} from '@taalcut/core';
import { z } from 'zod';

export interface MakeState {
  /** slot → clip id. */
  readonly slots: Map<number, string>;
  exports: number;
  breakdowns: number;
}

export function createMakeState(): MakeState {
  return {
    slots: new Map([
      [1, 'clip-a'],
      [2, 'clip-b'],
      [3, 'clip-c'],
    ]),
    exports: 0,
    breakdowns: 0,
  };
}

const swapPayload = z.object({ projectId: idSchema<'Project'>(), slot: z.int().min(1), clipId: z.string() });
const exportPayload = z.object({ projectId: idSchema<'Project'>(), preset: z.string() });

export function makeCommands(state: MakeState): AnyCommand[] {
  return [
    defineCommand({
      name: 'timeline.swapClip',
      payload: swapPayload,
      sideEffect: 'write',
      handle({ projectId, slot, clipId }) {
        const before = state.slots.get(slot) ?? 'none';
        state.slots.set(slot, clipId);
        return ok({
          result: { slot, clipId },
          inverse: { name: 'timeline.swapClip', payload: { projectId, slot, clipId: before } },
        });
      },
    }),
    defineCommand({
      name: 'timeline.clearSlot',
      payload: z.object({ projectId: idSchema<'Project'>(), slot: z.int().min(1) }),
      sideEffect: 'destructive',
      handle({ slot }) {
        state.slots.delete(slot);
        return ok({ result: { slot } });
      },
    }),
    defineCommand({
      name: 'render.export',
      payload: exportPayload,
      sideEffect: 'write',
      handle() {
        state.exports += 1;
        return ok({ result: { renderId: `render-${state.exports}` } });
      },
    }),
  ];
}

const projectId = ulidSchema('Project');

export function makeModules(state: MakeState): ToolModule[] {
  const templates = defineToolModule({
    id: 'templates',
    tools: [
      defineTool({
        name: 'templates.breakdown',
        version: '1.0.0',
        description: 'Breaks a reference reel down into timed slots with their intents.',
        input: z.object({ reference: z.string().min(1) }),
        output: z.object({ slots: z.array(z.object({ index: z.int(), seconds: z.number() })) }),
        costClass: 'local',
        sideEffect: 'read',
        timeoutMs: 5_000,
        retry: NO_TOOL_RETRY,
        run: async () => {
          state.breakdowns += 1;
          return ok({ slots: [1, 2, 3].map((index) => ({ index, seconds: index * 1.5 })) });
        },
      }),
    ],
  });
  const timeline = defineToolModule({
    id: 'timeline',
    tools: [
      defineTool({
        name: 'timeline.swapClip',
        version: '1.0.0',
        description: 'Puts another clip into one slot of the timeline.',
        input: z.object({ projectId, slot: z.int().min(1), clipId: z.string().min(1) }),
        output: z.object({ slot: z.int(), clipId: z.string() }),
        costClass: 'local',
        sideEffect: 'write',
        timeoutMs: 5_000,
        retry: NO_TOOL_RETRY,
        command: 'timeline.swapClip',
        idempotencyKey: (input) => `${input.projectId}:${input.slot}:${input.clipId}`,
        run: async (input, ctx) => {
          const done = await ctx.dispatch(input);
          return done.ok ? ok({ slot: input.slot, clipId: input.clipId }) : done;
        },
      }),
      defineTool({
        name: 'timeline.clearSlot',
        version: '1.0.0',
        description: 'Empties one slot of the timeline.',
        input: z.object({ projectId, slot: z.int().min(1) }),
        output: z.object({ slot: z.int() }),
        costClass: 'local',
        sideEffect: 'destructive',
        timeoutMs: 5_000,
        retry: NO_TOOL_RETRY,
        command: 'timeline.clearSlot',
        idempotencyKey: (input) => `${input.projectId}:${input.slot}`,
        run: async (input, ctx) => {
          const done = await ctx.dispatch(input);
          return done.ok ? ok({ slot: input.slot }) : done;
        },
      }),
    ],
  });
  const render = defineToolModule({
    id: 'render',
    tools: [
      defineTool({
        name: 'render.export',
        version: '2.0.0',
        description: 'Renders the timeline to a video file with a platform preset.',
        input: z.object({ projectId, preset: z.string().min(1) }),
        output: z.object({ renderId: z.string() }),
        costClass: 'local',
        sideEffect: 'write',
        checkpoint: true,
        timeoutMs: 5_000,
        retry: NO_TOOL_RETRY,
        command: 'render.export',
        idempotencyKey: (input) => `${input.projectId}:${input.preset}`,
        run: async (input, ctx) => {
          const done = await ctx.dispatch(input);
          return done.ok ? ok({ renderId: `render-${state.exports}` }) : done;
        },
      }),
    ],
  });
  const cloud = defineToolModule({
    id: 'cloud',
    tools: [
      defineTool({
        name: 'cloud.describe',
        version: '1.0.0',
        description: 'Describes a frame with a cloud model.',
        input: z.object({ frame: z.string() }),
        output: z.object({ text: z.string() }),
        costClass: 'paid',
        sideEffect: 'external',
        permission: { network: 'internet' },
        estimateCost: () => ({ usd: 0.01 }),
        timeoutMs: 5_000,
        retry: NO_TOOL_RETRY,
        idempotencyKey: (input) => input.frame,
        run: async () => ok({ text: 'a frame' }),
      }),
    ],
  });
  const sandbox = defineToolModule({
    id: 'sandbox',
    tools: [
      defineTool({
        name: 'sandbox.listExperiments',
        version: '1.0.0',
        description: "Lists the built-in agent's scratch experiments.",
        input: z.object({}),
        output: z.object({ ids: z.array(z.string()) }),
        costClass: 'local',
        sideEffect: 'read',
        timeoutMs: 1_000,
        retry: NO_TOOL_RETRY,
        run: async () => ok({ ids: [] }),
      }),
    ],
  });
  const secret = defineToolModule({
    id: 'secret',
    tools: [
      defineTool({
        name: 'secret.peek',
        version: '1.0.0',
        description: 'Reads something only the built-in agent may read.',
        input: z.object({}),
        output: z.object({ ok: z.boolean() }),
        costClass: 'local',
        sideEffect: 'read',
        exposure: { mcp: false },
        timeoutMs: 1_000,
        retry: NO_TOOL_RETRY,
        run: async () => ok({ ok: true }),
      }),
    ],
  });
  return [templates, timeline, render, cloud, sandbox, secret];
}
