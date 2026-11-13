// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import {
  defineTool,
  defineToolModule,
  err,
  newId,
  NO_TOOL_RETRY,
  ok,
  unwrap,
  type AnyTool,
  type ToolModule,
} from '@taalcut/core';
import { z } from 'zod';
import {
  createToolExecutor,
  createToolRegistry,
  type ToolCommandBus,
  type ToolDispatchMeta,
  type ToolEvent,
  type ToolExecutorOptions,
  type ToolPolicy,
  type ToolRegistry,
} from '@taalcut/tools';
import { CaptionerBusy, createTestDomainTools, type Clip, type TestDomainServices } from './test-domain';

/** A module that was "already there" before the test domain was added. */
export const mediaModule: ToolModule = defineToolModule({
  id: 'media',
  tools: [
    defineTool({
      name: 'media.probe',
      version: '1.0.0',
      description: 'Reads the duration, streams and codecs of a video or audio file with ffprobe.',
      tags: ['ffprobe', 'metadata', 'video'],
      input: z.object({ path: z.string() }),
      output: z.object({ seconds: z.number() }),
      costClass: 'local',
      sideEffect: 'read',
      timeoutMs: 30_000,
      retry: NO_TOOL_RETRY,
      permission: { filesystem: { read: ['library', 'user-selected'] } },
      run: async () => ok({ seconds: 12.5 }),
    }),
  ],
});

export function fakeServices(options: { busyTimes?: number; clips?: Clip[] } = {}) {
  let busy = options.busyTimes ?? 0;
  const clips = options.clips ?? [
    { id: 'c1', title: 'Beach', seconds: 4 },
    { id: 'c2', title: 'Drone', seconds: 7 },
  ];
  const services: TestDomainServices = {
    clips: { list: () => clips, get: (id) => clips.find((c) => c.id === id) },
    captioner: async (frame) => {
      if (busy > 0) {
        busy--;
        return err(CaptionerBusy());
      }
      return ok({ text: `A sunny beach (${frame})`, inputTokens: 1200 });
    },
  };
  return services;
}

export function recordingBus(fail = false) {
  const calls: { command: string; payload: unknown; meta: ToolDispatchMeta }[] = [];
  const bus: ToolCommandBus = {
    dispatch: async (command, payload, meta) => {
      calls.push({ command, payload, meta });
      return fail ? err(CaptionerBusy()) : ok({ applied: true });
    },
  };
  return { bus, calls };
}

/** Approves everything and records each approval, as the agent's policy would in the run log. */
export function approvingPolicy() {
  const approvals: string[] = [];
  const policy: ToolPolicy = {
    authorize: (request) => {
      if (!request.approvalRequired) return { kind: 'allow' };
      const id = `approval-${approvals.length + 1}`;
      approvals.push(`${id}:${request.tool.name}`);
      return { kind: 'allow', approvalId: id };
    },
  };
  return { policy, approvals };
}

/** Call options for a call in a fresh agent run: tools that change state need a run (or scope). */
export const inRun = () => ({ runId: newId<'AgentRun'>() });

export function registryWith(...modules: ToolModule[]): ToolRegistry {
  return unwrap(createToolRegistry(modules));
}

export function setup(
  options: Partial<ToolExecutorOptions> & { modules?: ToolModule[]; services?: TestDomainServices } = {},
) {
  const registry = registryWith(
    ...(options.modules ?? [createTestDomainTools(options.services ?? fakeServices())]),
  );
  const events: ToolEvent[] = [];
  const executor = createToolExecutor({
    random: () => 0.5,
    ...options,
    registry,
    onEvent: (event) => {
      events.push(event);
      options.onEvent?.(event);
    },
  });
  return { registry, executor, events };
}

/** A one-off tool in module 'fx' for executor edge cases. */
export function fxTool(overrides: Partial<AnyTool> & Pick<AnyTool, 'run'>): AnyTool {
  return {
    name: 'fx.thing',
    version: '1.0.0',
    description: 'A test tool.',
    input: z.object({ n: z.number().default(1) }),
    output: z.object({ n: z.number() }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 1_000,
    retry: NO_TOOL_RETRY,
    ...overrides,
  };
}

export const fxModule = (...tools: AnyTool[]): ToolModule => ({ id: 'fx', tools });
