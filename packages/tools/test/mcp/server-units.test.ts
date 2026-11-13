// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The mcp process's parts: the session cache survives the agent restarting and reports sessions that went away;
 * the rate limiter and 2025 protocol sessions keep their bounds; the endpoint file is private; a taken port is
 * reported as port_in_use; a restarted agent turns into a tool error the client's model can act on.
 */
import { stat, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  newId,
  ProcessRestartedError,
  toRpcError,
  type Clock,
  type McpServerStatus,
  type McpSessionId,
} from '@taalcut/core';
import { createMcpServerHost, type McpGatewayClient } from '@taalcut/tools';
import { describe, expect, it } from 'vitest';
import { createLegacySessions } from '../../src/mcp/legacy-sessions';
import { createRateLimiter } from '../../src/mcp/rate';
import { createSessionCache, type GatewaySessionsSnapshot } from '../../src/mcp/session-cache';
import { writeEndpointFile } from '../../src/mcp/endpoint-file';
import { createToolBridge } from '../../src/mcp/tool-bridge';
import { freePort } from './helpers/world';

const fixed = (at = 1_000): Clock & { at: number } => {
  const clock = { at, now: () => clock.at };
  return clock;
};

function snapshot(...ids: McpSessionId[]): GatewaySessionsSnapshot {
  return {
    sessions: ids.map((id, i) => ({ id, tokenHash: String(i).repeat(64), level: 'edit', expiresAt: 10_000 })),
  };
}

describe('the session cache', () => {
  it('keeps the last set while the stream is down, follows the next one, and reports sessions gone', async () => {
    const a = newId<'McpSession'>();
    const b = newId<'McpSession'>();
    let opened = 0;
    const gone: string[] = [];
    const cache = createSessionCache({
      clock: fixed(),
      log: () => undefined,
      wait: async () => undefined,
      subscribe: async () => {
        opened += 1;
        if (opened === 1)
          return (async function* () {
            yield snapshot(a, b);
            throw toRpcError(ProcessRestartedError({ process: 'agent' }));
          })();
        return (async function* () {
          yield snapshot(a);
          await new Promise(() => undefined);
        })();
      },
    });
    cache.onGone((id) => gone.push(id));
    await cache.ready();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(opened).toBe(2);
    expect(cache.lookup('0'.repeat(64))).toEqual({ sessionId: a, level: 'edit' });
    expect(cache.lookup('1'.repeat(64))).toBeUndefined();
    expect(gone).toEqual([b]);
    cache.stop();
  });

  it('refuses an expired session even before the gateway says so', async () => {
    const clock = fixed(20_000);
    const cache = createSessionCache({
      clock,
      subscribe: async () =>
        (async function* () {
          yield snapshot(newId<'McpSession'>());
          await new Promise(() => undefined);
        })(),
    });
    await cache.ready();
    expect(cache.lookup('0'.repeat(64))).toBeUndefined();
    cache.stop();
  });
});

describe('bounds', () => {
  it('limits requests a minute and calls at once, per session', () => {
    const clock = fixed();
    const rate = createRateLimiter(clock, { requestsPerMinute: 3, maxConcurrentCalls: 2 });
    const s = newId<'McpSession'>();
    const first = rate.admit(s);
    const second = rate.admit(s);
    expect(rate.admit(s)).toEqual({ ok: false, retryAfterSeconds: 1 });
    if (first.ok) first.release();
    if (second.ok) second.release();
    expect(rate.admit(s).ok).toBe(true);
    const over = rate.admit(s);
    expect(over.ok).toBe(false);
    expect(!over.ok && over.retryAfterSeconds).toBe(60);
    clock.at += 60_000;
    expect(rate.admit(s).ok).toBe(true);
    expect(rate.admit(newId<'McpSession'>()).ok).toBe(true);
  });

  it('keeps at most 32 protocol sessions per bearer and forgets idle ones', () => {
    const clock = fixed();
    const legacy = createLegacySessions(clock);
    const s = newId<'McpSession'>();
    const first = legacy.mint(s);
    for (let i = 0; i < 32; i++) {
      clock.at += 1;
      legacy.mint(s);
    }
    expect(legacy.check(first, s)).toBe('unknown');
    const recent = legacy.mint(s);
    expect(legacy.check(recent, newId<'McpSession'>())).toBe('unknown');
    clock.at += 25 * 60 * 60_000;
    expect(legacy.check(recent, s)).toBe('unknown');
  });

  it('writes the endpoint file for the account only', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'taalcut-endpoint-')), 'mcp', 'endpoint.json');
    expect(
      (await writeEndpointFile(file, { url: 'http://127.0.0.1:41730/mcp', pid: 7, startedAt: 1 })).ok,
    ).toBe(true);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      url: 'http://127.0.0.1:41730/mcp',
      pid: 7,
      startedAt: 1,
    });
  });
});

function gatewayStub(reports: McpServerStatus[]): McpGatewayClient {
  const never = () => Promise.reject(new Error('not used'));
  return {
    sessions: async () =>
      (async function* () {
        yield { sessions: [] };
        await new Promise(() => undefined);
      })(),
    listTools: never,
    call: never,
    touch: async () => undefined,
    reportStatus: async (status) => {
      reports.push(status);
    },
  };
}

describe('the server host', () => {
  it('reports port_in_use when another app holds the port', async () => {
    const port = await freePort();
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(port, '127.0.0.1', resolve));
    const reports: McpServerStatus[] = [];
    const host = createMcpServerHost({
      gateway: gatewayStub(reports),
      port,
      clock: fixed(),
      version: '0',
      log: () => undefined,
    });
    const started = await host.start();
    expect(!started.ok && started.error).toMatchObject({ code: 'mcp.port_in_use', params: { port } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(reports).toEqual([expect.objectContaining({ state: 'error', port })]);
    await host.stop();
    taken.close();
  });
});

describe('the tool bridge', () => {
  it('turns an agent restart into a tool error the model can retry', async () => {
    const sessionId = newId<'McpSession'>();
    const factory = createToolBridge({
      clock: fixed(),
      version: '0',
      gateway: {
        listTools: async () => ({
          tools: [
            {
              name: 'templates_breakdown',
              title: 'Breakdown',
              description: 'x',
              inputSchema: { type: 'object', properties: {} },
              annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
              },
            },
          ],
          instructions: 'hi',
        }),
        call: async () => {
          throw toRpcError(ProcessRestartedError({ process: 'agent' }));
        },
      },
    });
    const server = await factory({
      era: 'modern',
      authInfo: { token: '', clientId: sessionId, scopes: [], extra: { sessionId, level: 'read' } },
    });
    expect(server).toBeDefined();
    await expect(factory({ era: 'modern' })).rejects.toThrow(/No session/);
  });
});
