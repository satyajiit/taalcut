// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The gateway's parts without HTTP: the MCP commands (undo, limits, refusals), the session store (expiry, last-used
 * times persisted at most once a minute), Settings' state (server status rules, views without token hashes) and the
 * results external agents read.
 */
import {
  createCommandBus,
  createMemoryAuditLogStore,
  createMemorySettingsStore,
  defineError,
  MCP_COMMANDS,
  MCP_ENABLED_SETTING,
  MCP_MAX_SESSIONS,
  MCP_PORT_SETTING,
  MCP_SESSION_IDLE_EXPIRY_MS,
  newId,
  ok,
  unwrap,
  type Clock,
  type McpLevel,
  type McpSessionId,
} from '@taalcut/core';
import {
  createMcpGateway,
  createToolRegistry,
  MCP_LAST_USED_SETTING,
  tokenHash,
  type McpGateway,
} from '@taalcut/tools';
import { describe, expect, it } from 'vitest';
import { doneItem, errorItem } from '../../src/mcp-gateway/results';
import { createMakeState, makeModules } from './helpers/domain';

const person = { source: 'ui', actor: 'user' } as const;

async function setup(now = { value: 1_000_000 }) {
  const clock: Clock = { now: () => now.value };
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock });
  const settings = createMemorySettingsStore();
  const closed: string[] = [];
  const gateway: McpGateway = createMcpGateway({
    registry: unwrap(createToolRegistry(makeModules(createMakeState()))),
    runner: {
      open: async () => ok({ runId: newId<'AgentRun'>(), conversationId: newId<'Conversation'>() }),
      call: async () => ok({ kind: 'declined' }),
      close: async (runId) => {
        closed.push(runId);
        return ok(undefined);
      },
    },
    bus,
    settings,
    clock,
    log: () => undefined,
  });
  bus.register(...gateway.commands);
  unwrap(await gateway.start());
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
  let counter = 0;
  const add = async (level: McpLevel = 'edit') => {
    const sessionId = newId<'McpSession'>();
    counter += 1;
    const added = await gateway.sessionWrites.add({
      sessionId,
      name: `Agent ${counter}`,
      client: 'claude-code',
      level,
      tokenHash: tokenHash(`tcm_${String(counter).padStart(43, 'k')}`),
    });
    await settle();
    return { sessionId, added };
  };
  return { clock, now, bus, settings, gateway, closed, settle, add };
}

describe('MCP commands', () => {
  it('turns MCP on and off and changes the port with an undo', async () => {
    const { bus, settings, gateway, settle } = await setup();
    expect(gateway.state()).toMatchObject({ enabled: false, server: { state: 'off', port: 41730 } });
    unwrap(await bus.dispatch(MCP_COMMANDS.setEnabled, { enabled: true }, person));
    unwrap(await bus.dispatch(MCP_COMMANDS.setPort, { port: 42000 }, person));
    await settle();
    expect(gateway.state().server).toEqual({ state: 'starting', port: 42000 });
    unwrap(await bus.undo(null, person));
    expect(unwrap(await settings.get(MCP_PORT_SETTING))).toBe(41730);
    expect(unwrap(await settings.get(MCP_ENABLED_SETTING))).toBe(true);
  });

  it('renames and changes a level, each undoable, and revokes for good', async () => {
    const { bus, gateway, closed, settle, add } = await setup();
    const { sessionId } = await add('read');
    unwrap(await bus.dispatch(MCP_COMMANDS.setSessionLevel, { sessionId, level: 'export' }, person));
    unwrap(await bus.dispatch(MCP_COMMANDS.renameSession, { sessionId, name: 'Codex at work' }, person));
    await settle();
    expect(gateway.state().sessions[0]).toMatchObject({ name: 'Codex at work', level: 'export' });
    unwrap(await bus.undo(null, person));
    unwrap(await bus.undo(null, person));
    await settle();
    expect(gateway.state().sessions[0]).toMatchObject({ name: 'Agent 1', level: 'read' });

    unwrap(await bus.dispatch(MCP_COMMANDS.revokeSession, { sessionId }, person));
    await settle();
    expect(gateway.state().sessions[0]?.status).toBe('revoked');
    expect(closed).toHaveLength(1);
    expect(gateway.listTools(sessionId).ok).toBe(false);
    const again = await bus.dispatch(MCP_COMMANDS.revokeSession, { sessionId }, person);
    expect(!again.ok && again.error.code).toBe('core.validation');
  });

  it(`refuses a seventeenth live session and a reused token`, async () => {
    const { gateway, add } = await setup();
    for (let i = 0; i < MCP_MAX_SESSIONS; i++) unwrap((await add()).added);
    const over = await add();
    expect(!over.added.ok && over.added.error.code).toBe('mcp.too_many_sessions');
    const reused = await gateway.sessionWrites.add({
      sessionId: newId<'McpSession'>(),
      name: 'Dup',
      client: 'other',
      level: 'read',
      tokenHash: tokenHash(`tcm_${'1'.padStart(43, 'k')}`),
    });
    expect(reused.ok).toBe(false);
  });

  it('rotates a token, refusing one already used', async () => {
    const { gateway, settle, add } = await setup();
    const { sessionId } = await add();
    const hashBefore = (await gateway.sessions().next()).value?.sessions[0]?.tokenHash;
    unwrap(await gateway.sessionWrites.rotate({ sessionId, tokenHash: 'f'.repeat(64) }));
    await settle();
    const hashAfter = (await gateway.sessions().next()).value?.sessions[0]?.tokenHash;
    expect(hashAfter).toBe('f'.repeat(64));
    expect(hashAfter).not.toBe(hashBefore);
    const reused = await gateway.sessionWrites.rotate({ sessionId, tokenHash: 'f'.repeat(64) });
    expect(reused.ok).toBe(false);
  });
});

describe("main's session writes (mcpSessions, contract round P3-2)", () => {
  it('are not commands: the bus gets the five person-only ones', async () => {
    const { gateway } = await setup();
    expect(gateway.commands.map((command) => command.name).sort()).toEqual(
      [
        MCP_COMMANDS.renameSession,
        MCP_COMMANDS.revokeSession,
        MCP_COMMANDS.setEnabled,
        MCP_COMMANDS.setPort,
        MCP_COMMANDS.setSessionLevel,
      ].sort(),
    );
    for (const command of gateway.commands) expect(command.sources).toEqual(['ui', 'shortcut']);
  });

  it('add and rotate, and the sessions reload at once', async () => {
    const { gateway } = await setup();
    const sessionId = newId<'McpSession'>();
    const added = await gateway.sessionWrites.add({
      sessionId,
      name: 'Codex',
      client: 'codex',
      level: 'read',
      tokenHash: 'a'.repeat(64),
    });
    expect(added.ok && added.value.sessionId).toBe(sessionId);
    expect(gateway.state().sessions.map((session) => session.id)).toEqual([sessionId]);

    unwrap(await gateway.sessionWrites.rotate({ sessionId, tokenHash: 'b'.repeat(64) }));
    expect((await gateway.sessions().next()).value?.sessions[0]?.tokenHash).toBe('b'.repeat(64));
    const reused = await gateway.sessionWrites.rotate({ sessionId, tokenHash: 'b'.repeat(64) });
    expect(!reused.ok && reused.error.code).toBe('core.validation');
  });
});

describe('sessions over time', () => {
  it('reads active, then idle, then expired after 90 days unused', async () => {
    const { gateway, now, add } = await setup();
    const { sessionId } = await add();
    expect(gateway.state().sessions[0]?.status).toBe('idle');
    unwrap(gateway.touch(sessionId));
    expect(gateway.state().sessions[0]?.status).toBe('active');
    now.value += 11 * 60_000;
    expect(gateway.state().sessions[0]?.status).toBe('idle');
    now.value += MCP_SESSION_IDLE_EXPIRY_MS;
    expect(gateway.state().sessions[0]?.status).toBe('expired');
    const refused = gateway.touch(sessionId);
    expect(!refused.ok && refused.error.code).toBe('mcp.session_expired');
    expect((await gateway.sessions().next()).value?.sessions).toEqual([]);
  });

  it('persists last-used times at most once a minute', async () => {
    const { gateway, settings, now, add } = await setup();
    const { sessionId } = await add();
    unwrap(gateway.touch(sessionId));
    now.value += 5_000;
    unwrap(gateway.touch(sessionId));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(unwrap(await settings.get(MCP_LAST_USED_SETTING))[sessionId]).toBe(1_000_000);
    now.value += 60_000;
    unwrap(gateway.touch(sessionId));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(unwrap(await settings.get(MCP_LAST_USED_SETTING))[sessionId]).toBe(1_065_000);
  });

  it('never shows a token hash to Settings, and counts calls today', async () => {
    const { gateway, add } = await setup();
    const { sessionId } = await add('read');
    for await (const _ of gateway.call({
      sessionId,
      callKey: 'c'.repeat(64),
      name: 'taalcut_history',
      arguments: { projectId: newId<'Project'>() },
      wantsProgress: false,
    }));
    const view = gateway.state().sessions[0];
    expect(view && 'tokenHash' in view).toBe(false);
    expect(view?.callsToday).toBe(1);
  });
});

describe('the server status Settings shows', () => {
  it('believes a report only while on and for the same port', async () => {
    const { bus, gateway, settle } = await setup();
    gateway.reportStatus({ state: 'listening', port: 41730, url: 'http://127.0.0.1:41730/mcp' });
    expect(gateway.state().server.state).toBe('off');
    unwrap(await bus.dispatch(MCP_COMMANDS.setEnabled, { enabled: true }, person));
    await settle();
    expect(gateway.state().server.state).toBe('starting');
    gateway.reportStatus({ state: 'listening', port: 41730, url: 'http://127.0.0.1:41730/mcp' });
    expect(gateway.state().server).toMatchObject({ state: 'listening', url: 'http://127.0.0.1:41730/mcp' });
    gateway.reportStatus({ state: 'listening', port: 9999 });
    expect(gateway.state().server.state).toBe('starting');
    const changes = gateway.changed();
    expect((await changes.next()).value?.server.state).toBe('starting');
    gateway.reportStatus({
      state: 'error',
      port: 41730,
      error: { code: 'mcp.port_in_use', messageKey: 'errors.mcp.port_in_use', retryable: true },
    });
    expect((await changes.next()).value?.server.state).toBe('error');
    await changes.return(undefined);
  });
});

describe('results for external agents', () => {
  const Broke = defineError<{ path: string }>('test.broke', {
    retryable: true,
    fix: { command: 'settings.open', labelKey: 'fix.openSettings' },
  });

  it('carries code, params and the fix label, never detail', () => {
    const item = errorItem(Broke({ path: 'a.mp4' }, { detail: 'secret stack' }));
    expect(item).toEqual({
      type: 'result',
      isError: true,
      structuredContent: {
        error: { code: 'test.broke', retryable: true, params: { path: 'a.mp4' }, fix: 'fix.openSettings' },
      },
      text: "Taalcut couldn't do that (test.broke). Trying again later may work.",
    });
    expect(JSON.stringify(item)).not.toContain('secret stack');
  });

  it('gives the artifact summary for a spilled output, and no structured content for a non-object', () => {
    const base = {
      callId: newId<'ToolRun'>(),
      tool: 't.x',
      version: '1.0.0',
      inputHash: 'h',
      usage: { usd: 0, inputTokens: 0, outputTokens: 0 },
      cached: false,
      deduplicated: false,
      attempts: 1,
      durationMs: 1,
    };
    const spilled = doneItem({
      ...base,
      value: { big: true },
      output: {
        kind: 'artifact',
        ref: { id: newId<'Artifact'>(), mediaType: 'application/json', bytes: 9000, summary: 'A long list.' },
      },
    });
    expect(spilled.text).toBe('A long list. (stored in Taalcut as application/json, 9000 bytes)');
    expect(spilled.structuredContent).toEqual({ big: true });
    const list = doneItem({ ...base, value: [1, 2], output: { kind: 'inline', value: [1, 2] } });
    expect(list.structuredContent).toBeUndefined();
    expect(list.text).toBe('[1,2]');
  });

  it('a session id an agent made up is refused like a revoked one', async () => {
    const { gateway } = await setup();
    const unknown = gateway.listTools(newId<'McpSession'>() as McpSessionId);
    expect(!unknown.ok && unknown.error.code).toBe('mcp.session_revoked');
  });
});
