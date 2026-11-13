// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The whole MCP path in one process: a real command bus and tool registry, the gateway served over a real
 * MessagePort (so every value crosses core's mcpGatewayContract and its zod checks), and the real HTTP server on
 * a free loopback port. Sessions are added the way main adds them: a minted bearer, its hash handed over through
 * core's mcpSessionsContract (main → agent only).
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import {
  connectRpc,
  createCommandBus,
  createMemoryAuditLogStore,
  createMemorySettingsStore,
  MCP_COMMANDS,
  mcpGatewayContract,
  mcpSessionsContract,
  newId,
  serveRpc,
  systemClock,
  unwrap,
  type CommandBus,
  type McpLevel,
  type McpSessionId,
  type MemoryAuditLogStore,
  type ProjectId,
  type SettingsStore,
} from '@taalcut/core';
import {
  createMcpGateway,
  createMcpServerHost,
  createToolRegistry,
  mcpGatewayRouter,
  mcpSessionsRouter,
  tokenHash,
  type McpGateway,
  type McpLimits,
  type McpServerHost,
} from '@taalcut/tools';
import { createMakeState, makeCommands, makeModules, type MakeState } from './domain';
import { createTestRunner, type TestRunner } from './runner';

export interface World {
  readonly url: string;
  readonly port: number;
  readonly projectId: ProjectId;
  readonly state: MakeState;
  readonly bus: CommandBus;
  readonly audit: MemoryAuditLogStore;
  readonly settings: SettingsStore;
  readonly gateway: McpGateway;
  readonly runner: TestRunner;
  readonly host: McpServerHost;
  readonly logs: string[];
  readonly endpointFile: string;
  addSession(level: McpLevel, name?: string): Promise<{ sessionId: McpSessionId; token: string }>;
  revoke(sessionId: McpSessionId): Promise<void>;
  setLevel(sessionId: McpSessionId, level: McpLevel): Promise<void>;
  /** A new bearer for the session (main's rotateToken); the old one stops working. */
  rotate(sessionId: McpSessionId): Promise<string>;
  close(): Promise<void>;
}

export interface WorldOptions {
  readonly holdMs?: number;
  readonly progressEveryMs?: number;
  readonly limits?: McpLimits;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

export async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const person = { source: 'ui', actor: 'user' } as const;

export async function createWorld(options: WorldOptions = {}): Promise<World> {
  const state = createMakeState();
  const audit = createMemoryAuditLogStore();
  const bus = createCommandBus({ store: audit, clock: systemClock });
  bus.register(...makeCommands(state));
  const registry = unwrap(createToolRegistry(makeModules(state)));
  const settings = createMemorySettingsStore();
  const runner = createTestRunner(registry, bus);
  const gateway = createMcpGateway({
    registry,
    runner,
    bus,
    settings,
    clock: systemClock,
    ...(options.holdMs !== undefined ? { holdMs: options.holdMs } : {}),
    ...(options.progressEveryMs !== undefined ? { progressEveryMs: options.progressEveryMs } : {}),
    log: () => undefined,
  });
  bus.register(...gateway.commands);
  unwrap(await gateway.start());

  const { port1, port2 } = new MessageChannel();
  const served = serveRpc(mcpGatewayRouter(gateway), port1, { context: {}, exposeDetail: true });
  const client = connectRpc(mcpGatewayContract, port2, { peer: 'agent' });
  const mainSide = new MessageChannel();
  const servedSessions = serveRpc(mcpSessionsRouter(gateway), mainSide.port1, {
    context: {},
    exposeDetail: true,
  });
  const sessionsClient = connectRpc(mcpSessionsContract, mainSide.port2, { peer: 'agent' }).client;
  const port = await freePort();
  const logs: string[] = [];
  const endpointFile = join(mkdtempSync(join(tmpdir(), 'taalcut-mcp-')), 'mcp', 'endpoint.json');
  const host = createMcpServerHost({
    gateway: client.client,
    port,
    clock: systemClock,
    version: '0.0.0-test',
    endpointFile,
    log: (line) => logs.push(line),
    ...(options.limits ? { limits: options.limits } : {}),
  });
  unwrap(await host.start());
  const projectId = newId<'Project'>();

  const liveIn = async (sessionId: McpSessionId, live: boolean) =>
    waitFor(async () => {
      const sessions = await client.client.sessions(undefined, {});
      const first = await sessions.next();
      await sessions.return?.(undefined);
      const has = !first.done && first.value.sessions.some((session) => session.id === sessionId);
      return has === live;
    });

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    port,
    projectId,
    state,
    bus,
    audit,
    settings,
    gateway,
    runner,
    host,
    logs,
    endpointFile,
    async addSession(level, name = 'Test agent on this Mac') {
      const token = `tcm_${randomBytes(32).toString('base64url')}`;
      const sessionId = newId<'McpSession'>();
      await sessionsClient.addSession({
        sessionId,
        name,
        client: 'other',
        level,
        tokenHash: tokenHash(token),
      });
      await liveIn(sessionId, true);
      // The server's own copy follows the same stream; give it a moment to land.
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { sessionId, token };
    },
    async revoke(sessionId) {
      unwrap(await bus.dispatch(MCP_COMMANDS.revokeSession, { sessionId }, person));
      await liveIn(sessionId, false);
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
    async setLevel(sessionId, level) {
      unwrap(await bus.dispatch(MCP_COMMANDS.setSessionLevel, { sessionId, level }, person));
      await waitFor(() => gateway.state().sessions.some((s) => s.id === sessionId && s.level === level));
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
    async rotate(sessionId) {
      const token = `tcm_${randomBytes(32).toString('base64url')}`;
      await sessionsClient.rotateToken({ sessionId, tokenHash: tokenHash(token) });
      await new Promise((resolve) => setTimeout(resolve, 50));
      return token;
    },
    async close() {
      await host.stop();
      gateway.dispose();
      client.close();
      served.close();
      servedSessions.close();
      mainSide.port1.close();
      port1.close();
      port2.close();
    },
  };
}
