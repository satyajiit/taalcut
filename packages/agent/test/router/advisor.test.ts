// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The advisor over models' real Classifier (SPEC section 24): one `choice` over `none` plus the families,
 * the tool lines only as local hints, and the on-device rules router answering with no request. Also
 * `agent.setRouter` on core's real bus: person sources only, undoable.
 */
import {
  AGENT_SETTING_COMMANDS,
  createCommandBus,
  createManualClock,
  createMemoryAuditLogStore,
  createMemorySettingsStore,
  ROUTER_SETTING,
  unwrap,
} from '@taalcut/core';
import { createRouteAdvisor, createRouterCommands, routeRequest, type RouteAsk } from '@taalcut/agent';
import {
  createClassifier,
  createMemoryCloudCallSink,
  createModelRuntime,
  createStaticCredentialProvider,
  RULES_ROUTER,
} from '@taalcut/models';
import { describe, expect, it } from 'vitest';

const ask = (message: string): RouteAsk => ({
  message,
  stepText: 'Do what the user asked',
  turn: 0,
  lastFamilies: [],
  families: [
    { id: 'timeline', description: 'Assemble, trim, swap.', tools: 'timeline.trimClip: Trims a clip' },
    {
      id: 'audio',
      description: 'Beats, transcripts, loudness.',
      tools: 'audio.transcribe: Transcribes speech',
    },
  ],
  signal: new AbortController().signal,
  trace: { runId: 'run-1', spanId: 'call-1' },
});

describe('route advisor', () => {
  it('asks one choice over none and the families, with the tools only as local hints', () => {
    const request = routeRequest({ ...ask('trim it'), previousMessage: 'earlier ask' });
    expect(request.questions).toEqual({
      family: {
        type: 'choice',
        instructions: expect.stringContaining('Which tool family'),
        options: {
          none: expect.stringContaining('No tool'),
          timeline: 'Assemble, trim, swap.',
          audio: 'Beats, transcripts, loudness.',
        },
      },
    });
    expect(request.state).toEqual({
      message: 'trim it',
      stepText: 'Do what the user asked',
      turn: 0,
      lastFamilies: [],
      previousMessage: 'earlier ask',
    });
    expect(request.localHints?.family?.audio).toBe('audio.transcribe: Transcribes speech');
  });

  it('routes on this Mac with the rules router and logs the answer for the shadow record', async () => {
    const callLog = createMemoryCloudCallSink();
    const advisor = createRouteAdvisor({
      classifier: createClassifier({
        runtime: createModelRuntime({ builtinProviders: [] }),
        credentials: createStaticCredentialProvider({}),
        callLog,
        chain: [RULES_ROUTER],
      }),
      setting: async () => ({ ...ROUTER_SETTING.defaultValue, mode: 'shadow' }),
    });
    expect(advisor.timings).toEqual({ shadowMs: 2_000, liveMs: 800 });
    const outcome = await advisor.decide(ask('transcribe what she says'));
    expect(outcome).toMatchObject({
      kind: 'answered',
      answer: { choice: 'audio', model: 'taalcut/rules-router', costUsd: 0 },
    });
    expect(callLog.records[0]).toMatchObject({
      module: 'router',
      local: true,
      runId: 'run-1',
      spanId: 'call-1',
    });
    expect(await advisor.decide(ask('hello there'))).toMatchObject({ answer: { choice: 'none' } });
  });

  it('reports a classifier failure as a failed decision, and an unreadable setting as off', async () => {
    const advisor = createRouteAdvisor({
      classifier: createClassifier({
        runtime: createModelRuntime({ builtinProviders: [] }),
        credentials: createStaticCredentialProvider({}),
        callLog: createMemoryCloudCallSink(),
        chain: [],
      }),
      setting: () => Promise.reject(new Error('disk')),
    });
    expect(await advisor.decide(ask('trim'))).toEqual({
      kind: 'failed',
      errorCode: 'models.no_model_for_module',
    });
    expect((await advisor.setting()).mode).toBe('off');
  });
});

describe('agent.setRouter', () => {
  const ui = { source: 'ui', actor: 'user' } as const;
  const setup = () => {
    const settings = createMemorySettingsStore();
    const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: createManualClock(1_000) });
    bus.register(...createRouterCommands({ settings }).all);
    return { settings, bus };
  };

  it('a person turns shadow on and records a gate; undo puts the previous setting back', async () => {
    const { settings, bus } = setup();
    unwrap(await bus.dispatch(AGENT_SETTING_COMMANDS.setRouter, { mode: 'shadow' }, ui));
    unwrap(
      await bus.dispatch(
        AGENT_SETTING_COMMANDS.setRouter,
        { mode: 'on', families: { timeline: 'live' }, gate: { passedAt: 9, reportId: 'router-9' } },
        ui,
      ),
    );
    expect(unwrap(await settings.get(ROUTER_SETTING))).toEqual({
      mode: 'on',
      families: { timeline: 'live' },
      noneLive: false,
      gate: { passedAt: 9, reportId: 'router-9' },
    });
    unwrap(await bus.undo(null, ui));
    expect(unwrap(await settings.get(ROUTER_SETTING))).toEqual({
      ...ROUTER_SETTING.defaultValue,
      mode: 'shadow',
    });
  });

  it('refuses the agent and MCP clients', async () => {
    const { settings, bus } = setup();
    for (const origin of [
      { source: 'agent', actor: 'agent:run' },
      { source: 'mcp', actor: 'mcp:client' },
    ] as const) {
      const result = await bus.dispatch(AGENT_SETTING_COMMANDS.setRouter, { mode: 'on' }, origin);
      expect(result).toMatchObject({ ok: false, error: { code: 'core.command_source_refused' } });
    }
    expect(unwrap(await settings.get(ROUTER_SETTING)).mode).toBe('off');
  });
});
