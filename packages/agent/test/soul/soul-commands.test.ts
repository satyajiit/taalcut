// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Changing the dials (SPEC section 22): `agent.setSoulDials` on core's real command bus (app-wide, undoable,
 * from the person or the agent, never an MCP client) and the `soul.setDials` tool over it, called by a run
 * when the user asks for a lasting change. The next run starts with the new dials.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGENT_SETTING_COMMANDS,
  createCommandBus,
  createManualClock,
  createMemoryAuditLogStore,
  createMemorySettingsStore,
  SOUL_DIALS_SETTING,
  unwrap,
} from '@taalcut/core';
import {
  createCommandDispatcher,
  createSoulCommands,
  readSoul,
  SOUL_TOOL,
  soulToolModule,
} from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { call, harness, ofType, plan, registryFor, turns } from '../support/harness';
import { clipsModule } from '../support/fixtures';

const SOUL = unwrap(
  readSoul(readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'SOUL.md'), 'utf8')),
);
const STOPS = SOUL.stops ?? { tone: [], verbosity: [] };
const ui = { source: 'ui', actor: 'user' } as const;
const agent = { source: 'agent', actor: 'agent:run' } as const;
const mcp = { source: 'mcp', actor: 'mcp:client' } as const;

function setup() {
  const settings = createMemorySettingsStore();
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: createManualClock(1_000) });
  bus.register(...createSoulCommands({ settings }).all);
  const dials = async () => unwrap(await settings.get(SOUL_DIALS_SETTING));
  return { settings, bus, dials };
}

describe('agent.setSoulDials', () => {
  it('changes one dial, keeps the other, and undo puts both back', async () => {
    const { bus, dials } = setup();
    expect(await dials()).toEqual({ tone: 2, verbosity: 1 });
    const receipt = unwrap(await bus.dispatch(AGENT_SETTING_COMMANDS.setSoulDials, { tone: 4 }, ui));
    expect(receipt).toMatchObject({ projectId: null, undoable: true, result: { tone: 4, verbosity: 1 } });
    expect(await dials()).toEqual({ tone: 4, verbosity: 1 });
    unwrap(await bus.dispatch(AGENT_SETTING_COMMANDS.setSoulDials, { verbosity: 0 }, agent));
    expect(await dials()).toEqual({ tone: 4, verbosity: 0 });
    await bus.undo(null, ui);
    expect(await dials()).toEqual({ tone: 4, verbosity: 1 });
    await bus.undo(null, ui);
    expect(await dials()).toEqual({ tone: 2, verbosity: 1 });
    await bus.redo(null, ui);
    expect(await dials()).toEqual({ tone: 4, verbosity: 1 });
  });

  it('refuses MCP clients, an empty change and a stop out of range', async () => {
    const { bus, dials } = setup();
    const refused = await bus.dispatch(AGENT_SETTING_COMMANDS.setSoulDials, { tone: 0 }, mcp);
    expect(!refused.ok && refused.error.code).toBe('core.command_source_refused');
    for (const payload of [{}, { tone: 5 }, { verbosity: -1 }]) {
      const invalid = await bus.dispatch(AGENT_SETTING_COMMANDS.setSoulDials, payload, ui);
      expect(invalid.ok).toBe(false);
    }
    expect(await dials()).toEqual({ tone: 2, verbosity: 1 });
  });

  it('fails as the settings store fails, and changes nothing', async () => {
    const settings = createMemorySettingsStore();
    const broken = {
      ...settings,
      get: async () => ({
        ok: false as const,
        error: { code: 'library.busy', messageKey: 'x', retryable: true },
      }),
    };
    const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: createManualClock(1) });
    bus.register(...createSoulCommands({ settings: broken }).all);
    const failed = await bus.dispatch(AGENT_SETTING_COMMANDS.setSoulDials, { tone: 1 }, ui);
    expect(!failed.ok && failed.error.code).toBe('library.busy');
  });
});

describe('soul.setDials', () => {
  it('registers with full metadata and names the stops as SOUL.md does', () => {
    const registry = registryFor([clipsModule(), soulToolModule({ stops: STOPS })]);
    const tool = registry.resolve(SOUL_TOOL);
    expect(tool?.descriptor).toMatchObject({
      name: SOUL_TOOL,
      version: '1.0.0',
      costClass: 'local',
      sideEffect: 'write',
      command: AGENT_SETTING_COMMANDS.setSoulDials,
      timeoutMs: 5_000,
    });
    expect(tool?.spec.exposure).toEqual({ mcp: false });
    expect(tool?.spec.description).toMatch(/only when the user asks for a lasting change/);
    expect(JSON.stringify(tool?.spec.input)).toBeDefined();
    expect(tool?.spec.input.safeParse({ tone: 'professional' }).success).toBe(true);
    expect(tool?.spec.input.safeParse({ tone: 'grumpy' }).success).toBe(false);
    expect(tool?.spec.input.safeParse({}).success).toBe(false);
  });

  it('a run moves the dial through the command; the next run starts with it', async () => {
    const { bus, settings, dials } = setup();
    const script = turns(
      plan('Be more professional from now on'),
      { toolCalls: [call('findTools', { query: 'tone dial professional' })] },
      { toolCalls: [call('soul_setDials', { tone: 'professional', verbosity: 'justDoIt' })] },
      { text: 'From your next request I will keep it professional.' },
    );
    const h = harness({
      script,
      modules: [clipsModule(), soulToolModule({ stops: STOPS })],
      deps: {
        soul: SOUL,
        commands: createCommandDispatcher(bus),
        phase3: { soulDials: async () => unwrap(await settings.get(SOUL_DIALS_SETTING)) },
      },
    });
    const first = unwrap(await h.agent.run({ conversationId: 'c', message: 'Always be professional.' }));
    expect(first.status).toBe('completed');
    const events = await h.events(first.runId);
    const asked = ofType(events, 'tool.requested').find((e) => e.payload.tool === SOUL_TOOL);
    const done = ofType(events, 'tool.completed').find(
      (e) => e.payload.toolCallId === asked?.payload.toolCallId,
    );
    expect(done?.payload.output).toMatchObject({
      value: {
        tone: { stop: 'professional', name: 'professional' },
        verbosity: { stop: 'justDoIt', name: 'just do it' },
        appliesFrom: 'nextRun',
      },
    });
    expect(await dials()).toEqual({ tone: 4, verbosity: 0 });
    // This run kept its starting dials; the next one starts with the new ones.
    expect(h.models.requests.at(-1)?.system).toContain('Tone: balanced (3 of 5');

    const before = h.models.requests.length;
    const second = unwrap(await h.agent.run({ conversationId: 'c', message: 'Trim clip 1.' }));
    expect(second.status).toBe('completed');
    expect(h.models.requests[before]?.system).toContain('Tone: professional (5 of 5');
  });
});
