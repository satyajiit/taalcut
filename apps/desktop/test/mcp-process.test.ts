// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The mcp process as the app runs it (P3-V4), in process: the agent root's gateway, main's services forwarding it,
 * main's setup minting the bearer, and the mcp root listening on loopback. A client with the copied bearer lists
 * tools and calls one through the agent's external runner; a revoke shuts it out; a window can't add a session.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callRpc, MCP_COMMANDS, newId, ok, type McpLevel } from '@taalcut/core';
import { createMemorySecretStore } from '@taalcut/models';
import type { ExternalRunner } from '@taalcut/tools';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpSetup } from '../src/main/mcp/mcp-setup-router';
import { agentSessionHashes } from '../src/main/mcp/session-hashes';
import { ExternalRunnerToken } from '../src/shared/tokens';
import { composeMcp, mcpEndpointFile } from '../src/utility/roots/mcp-root';
import type { ComposeUtility } from '../src/utility/runtime';
import { closeAllPorts, fakeHost } from './helpers/fake-utility';
import { testAgent } from './helpers/roots';

const dirs: string[] = [];
afterEach(() => {
  closeAllPorts();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address ? resolve(address.port) : reject(new Error()),
      );
    });
  });
}

async function waitFor<T>(probe: () => Promise<T | undefined> | T | undefined, ms = 10_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

interface RunnerCall {
  readonly name: string;
  readonly level: McpLevel;
  readonly origin: { source: string; actor: string };
}

function fakeRunner(calls: RunnerCall[], closed: string[]): ExternalRunner {
  return {
    open: async () => ok({ runId: newId<'AgentRun'>(), conversationId: newId<'Conversation'>() }),
    call: async (_runId, name, _input, options) => {
      calls.push({ name, level: options.level, origin: options.origin });
      return ok({ kind: 'declined' });
    },
    close: async (runId) => {
      closed.push(runId);
      return ok(undefined);
    },
  };
}

interface RpcAnswer {
  readonly status: number;
  readonly session: string | null;
  readonly body: unknown;
}

/** One JSON-RPC message over Streamable HTTP, as a 2025-11-25 client sends it; reads a JSON or SSE answer. */
async function rpc(url: string, token: string, message: object, session?: string): Promise<RpcAnswer> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      ...(session ? { 'mcp-session-id': session, 'mcp-protocol-version': '2025-11-25' } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', ...message }),
  });
  const text = await response.text();
  const data = text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6))
    .at(-1);
  const raw = data ?? text;
  return {
    status: response.status,
    session: response.headers.get('mcp-session-id'),
    body: raw ? JSON.parse(raw) : undefined,
  };
}

function initialize(url: string, token: string): Promise<RpcAnswer> {
  return rpc(url, token, {
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'codex-test', version: '1' },
    },
  });
}

describe('the mcp process in the app', () => {
  it('serves the copied bearer, runs a call through the runner, and refuses it after a revoke', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'taalcut-mcp-'));
    dirs.push(userData);
    const port = await freePort();
    const calls: RunnerCall[] = [];
    const closed: string[] = [];
    const runner = fakeRunner(calls, closed);
    const roots = (name: string): ComposeUtility =>
      name === 'mcp'
        ? (config, main) =>
            composeMcp({ ...config, userData, mcpPort: port, appVersion: '1.2.3' }, main, 4242)
        : (config, main) => {
            const root = testAgent(config, main ? { main } : {});
            root.container.value(ExternalRunnerToken, runner);
            return root;
          };
    const { host, latest } = fakeHost(roots);
    host.start('agent');
    const dispatch = (name: string, payload: unknown) =>
      callRpc(host.client('agent').commands.dispatch({ name, payload, source: 'ui' }));
    await waitFor(async () =>
      (await dispatch(MCP_COMMANDS.setEnabled, { enabled: true })).ok ? true : undefined,
    );

    const clipboard: string[] = [];
    const setup = createMcpSetup({
      vault: createMemorySecretStore(),
      sessions: agentSessionHashes(() => host.client('agent')),
      port: () => port,
      shimPath: '/x/taalcut',
      clipboard: {
        writeText: (text) => void clipboard.push(text),
        readText: () => clipboard.at(-1) ?? '',
        clear: () => undefined,
      },
      schedule: () => undefined,
    });
    const created = await setup.createSession({
      name: 'Codex',
      client: 'codex',
      level: 'read',
      copy: 'codex-http',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const token = /Bearer (tcm_[A-Za-z0-9_-]{43})/.exec(clipboard[0] ?? '')?.[1] ?? '';
    expect(token).not.toBe('');

    host.start('mcp');
    const url = `http://127.0.0.1:${port}/mcp`;
    await waitFor(() => (existsSync(mcpEndpointFile(userData)) ? true : undefined));
    expect(JSON.parse(readFileSync(mcpEndpointFile(userData), 'utf8'))).toMatchObject({ url, pid: 4242 });
    expect((await initialize(url, `tcm_${'x'.repeat(43)}`)).status).toBe(401);

    const opened = await waitFor(async () => {
      const answer = await initialize(url, token);
      return answer.status === 200 ? answer : undefined;
    });
    expect(opened.body).toMatchObject({ result: { serverInfo: { name: 'taalcut', version: '1.2.3' } } });
    const session = opened.session ?? '';
    expect(session).not.toBe('');
    expect((await rpc(url, token, { method: 'notifications/initialized' }, session)).status).toBe(202);

    const listed = await rpc(url, token, { id: 2, method: 'tools/list' }, session);
    const tools = (
      listed.body as { result: { tools: { name: string; inputSchema: { required?: string[] } }[] } }
    ).result.tools;
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['taalcut_history']));
    expect(tools.some((tool) => tool.name.startsWith('sandbox'))).toBe(false);
    const free = tools.find(
      (tool) => !tool.inputSchema.required?.length && !tool.name.startsWith('taalcut_'),
    );
    expect(free).toBeDefined();
    if (!free) return;
    const called = await rpc(
      url,
      token,
      { id: 3, method: 'tools/call', params: { name: free.name, arguments: {} } },
      session,
    );
    expect(called.body).toMatchObject({ result: { isError: true } });
    expect(calls).toEqual([
      {
        name: expect.any(String),
        level: 'read',
        origin: { source: 'mcp', actor: `mcp:${created.value.sessionId}` },
      },
    ]);

    // A window can't give itself a session or a new key: no command carries a hash any more (contract round P3-2),
    // and mcpSessions isn't on a window's routes; the person's other MCP commands pass.
    const window = host.client('agent');
    const forged = await callRpc(
      window.commands.dispatch({
        name: 'mcp.addSession',
        payload: {
          sessionId: newId<'McpSession'>(),
          name: 'X',
          client: 'other',
          level: 'export',
          tokenHash: 'a'.repeat(64),
        },
        source: 'ui',
      }),
    );
    expect(!forged.ok && forged.error.code).toBe('core.not_found');
    const rotate = await callRpc(
      window.commands.dispatch({
        name: 'mcp.rotateToken',
        payload: { sessionId: created.value.sessionId, tokenHash: 'b'.repeat(64) },
        source: 'ui',
      }),
    );
    expect(!rotate.ok && rotate.error.code).toBe('core.not_found');

    const revoked = await callRpc(
      window.commands.dispatch({
        name: MCP_COMMANDS.revokeSession,
        payload: { sessionId: created.value.sessionId },
        source: 'ui',
      }),
    );
    expect(revoked.ok).toBe(true);
    expect(closed).toHaveLength(1);
    await waitFor(async () =>
      (await rpc(url, token, { id: 4, method: 'tools/list' }, session)).status === 401 ? true : undefined,
    );

    await latest('mcp')?.handle.dispose();
    await latest('agent')?.handle.dispose();
    await host.stopAll();
  }, 60_000);
});
