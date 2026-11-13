// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V4 in the running app (unpackaged build, placeholder renderer). External agents is off by default: no mcp
 * process, nothing listening. Turned on from a window (the person's command), main starts the mcp process on
 * 127.0.0.1 at the chosen port and it writes the endpoint file the `taalcut mcp` shim reads. The server refuses a
 * request without a known bearer (401), a web page's Origin and another Host (DNS rebinding, 403), and a window can't
 * register or rotate a bearer hash it chose (SB-14: since contract round P3-2 no command carries a hash). Turned off, the process stops and the port closes.
 *
 * A session made from a window runs on the agent's external runner (`createExternalRunner`, registered by
 * roots/agent-external-runs.ts): main mints the bearer, keeps it in the vault and copies the setup text, which this
 * test reads from main's clipboard (the Mac's clipboard is saved first and put back); a client with that bearer is
 * served, and once the person revokes the session it is refused. The client journeys (Claude Code's 2026-07-28
 * runtime and Codex's 2025-11-25 one: breakdown, swap, undo, approval, revoke) run against the real server in
 * packages/tools/test/mcp and, with main's setup and the agent's gateway, in test/mcp-process.test.ts.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchElectron } from './launch';
import { dispatchAsPerson } from './probe-commands';
import { servicePid } from './utility-pids';

let app: ElectronApplication;
let page: Page;
let userData: string;
let port: number;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  port = await freePort();
  userData = mkdtempSync(join(tmpdir(), 'taalcut-e2e-mcp-'));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== 'TAALCUT_RENDERER_URL',
    ),
  );
  app = await launchElectron(userData, { env });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect.poll(() => utilityPid('agent'), { timeout: 15_000 }).toBeGreaterThan(0);
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userData, { recursive: true, force: true });
});

const endpointFile = (): string => join(userData, 'mcp', 'endpoint.json');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const found = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(found));
    });
  });
}

/** The utility processes' service names (main/utility/process-table.ts). */
const SERVICE_NAMES = { agent: 'Taalcut agent', mcp: 'Taalcut external agents' } as const;

const utilityPid = (name: keyof typeof SERVICE_NAMES) => servicePid(app, SERVICE_NAMES[name]);

/** commands.dispatch from the window as the person: 'ok' or the error code. */
function dispatch(name: string, payload: unknown): Promise<string> {
  return dispatchAsPerson(page, name, payload);
}

/** The MCP part of Settings › External agents, as the window reads it. */
function mcpState(): Promise<
  { enabled: boolean; state: string; url?: string; sessions: number; sessionStates: string[] } | string
> {
  return page.evaluate(async () => {
    const rpc = await window.taalcutProbe?.client;
    if (!rpc) return 'no client';
    const read = await rpc.mcp.state();
    return {
      enabled: read.enabled,
      state: read.server.state,
      sessions: read.sessions.length,
      sessionStates: read.sessions.map((session) => session.status),
      ...(read.server.url ? { url: read.server.url } : {}),
    };
  });
}

interface Answer {
  readonly status: number;
  readonly body: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/** A raw request to the server: every header as given (fetch would not send another Host). */
function post(headers: Record<string, string>, body = '{}'): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const sent = request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          host: `127.0.0.1:${port}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'content-length': String(Buffer.byteLength(body)),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers,
          }),
        );
      },
    );
    sent.once('error', reject);
    sent.end(body);
  });
}

/** Whether anything accepts a connection on the port. */
function listening(): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = request({ host: '127.0.0.1', port, path: '/mcp', method: 'GET' }, (res) => {
      res.resume();
      resolve(true);
    });
    probe.once('error', () => resolve(false));
    probe.end();
  });
}

const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'e2e', version: '1.0.0' },
  },
});

test('off by default: no mcp process and nothing listening', async () => {
  expect(await mcpState()).toMatchObject({ enabled: false, state: 'off', sessions: 0 });
  expect(await utilityPid('mcp')).toBeUndefined();
  expect(await listening()).toBe(false);
  expect(existsSync(endpointFile())).toBe(false);
});

test('turned on, the mcp process listens on 127.0.0.1 and writes the endpoint file for the shim', async () => {
  expect(await dispatch('mcp.setPort', { port })).toBe('ok');
  expect(await dispatch('mcp.setEnabled', { enabled: true })).toBe('ok');
  await expect.poll(() => utilityPid('mcp'), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect
    .poll(async () => mcpState(), { timeout: 15_000 })
    .toMatchObject({ enabled: true, state: 'listening', url: `http://127.0.0.1:${port}/mcp` });
  await expect.poll(() => existsSync(endpointFile()), { timeout: 5_000 }).toBe(true);
  const endpoint: unknown = JSON.parse(readFileSync(endpointFile(), 'utf8'));
  expect(endpoint).toMatchObject({ url: `http://127.0.0.1:${port}/mcp`, pid: await utilityPid('mcp') });
  expect(statSync(endpointFile()).mode & 0o777).toBe(0o600);
  expect(statSync(join(userData, 'mcp')).mode & 0o777).toBe(0o700);
  expect(readFileSync(endpointFile(), 'utf8')).not.toContain('tcm_');
});

test('refuses a request without a known bearer, from a web page, or for another host', async () => {
  const anonymous = await post({}, INITIALIZE);
  expect(anonymous.status).toBe(401);
  // No OAuth discovery hints: the bearer comes from Taalcut's setup text, nowhere else.
  expect(anonymous.headers['www-authenticate']).toBeUndefined();
  const unknown = await post({ authorization: `Bearer tcm_${'x'.repeat(43)}` }, INITIALIZE);
  expect(unknown.status).toBe(401);
  // A page in a browser on this Mac, and DNS rebinding (a name that resolves to 127.0.0.1).
  expect((await post({ origin: 'https://example.com' }, INITIALIZE)).status).toBe(403);
  expect((await post({ host: `rebind.example:${port}` }, INITIALIZE)).status).toBe(403);
  expect((await post({ 'sec-fetch-site': 'cross-site' }, INITIALIZE)).status).toBe(403);
});

test('a window cannot register or rotate a bearer hash it chose', async () => {
  const hash = 'a'.repeat(64);
  const sessionId = '01J00000000000000000000000';
  expect(
    await dispatch('mcp.addSession', {
      sessionId,
      name: 'Mine',
      client: 'other',
      level: 'export',
      tokenHash: hash,
    }),
  ).toBe('core.not_found');
  expect(await dispatch('mcp.rotateToken', { sessionId, tokenHash: hash })).toBe('core.not_found');
  expect(await mcpState()).toMatchObject({ sessions: 0 });
});

test('a session made from a window serves the copied bearer, and once revoked it is refused', async () => {
  const saved = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    const created = await page.evaluate(async () => {
      const rpc = await window.taalcutProbe?.client;
      if (!rpc) return 'no client';
      return rpc.mcpSetup
        .createSession({
          name: 'Claude Code on this Mac',
          client: 'claude-code',
          level: 'edit',
          copy: 'claude-http',
        })
        .then(
          (answer) => answer,
          (error: { data?: { code?: string } }) => error.data?.code ?? String(error),
        );
    });
    if (typeof created === 'string') throw new Error(`createSession: ${created}`);
    expect(created.copied).toBe('claude-http');
    // Made, not used yet.
    expect(await mcpState()).toMatchObject({ sessions: 1, sessionStates: ['idle'] });
    // The window got an opaque id only; the bearer is in the text main copied.
    expect(JSON.stringify(created)).not.toMatch(/tcm_/);
    const text = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(text).toContain(`http://127.0.0.1:${port}/mcp`);
    const bearer = /Bearer (tcm_[A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? '';
    expect(bearer).not.toBe('');
    const auth = { authorization: `Bearer ${bearer}`, 'mcp-protocol-version': '2025-11-25' };

    const opened = await post(auth, INITIALIZE);
    expect(opened.status, opened.body).toBe(200);
    expect(opened.body).toContain('serverInfo');
    const protocolSession = opened.headers['mcp-session-id'];
    expect(typeof protocolSession).toBe('string');
    const listed = await post(
      { ...auth, 'mcp-session-id': String(protocolSession) },
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    );
    expect(listed.status, listed.body).toBe(200);
    expect(listed.body).toContain('"tools"');
    await expect
      .poll(async () => mcpState(), { timeout: 5_000 })
      .toMatchObject({ sessionStates: ['active'] });

    expect(await dispatch('mcp.revokeSession', { sessionId: created.sessionId })).toBe('ok');
    await expect.poll(async () => (await post(auth, INITIALIZE)).status, { timeout: 5_000 }).toBe(401);
    // Kept in the list (Settings shows it as revoked), never served again.
    expect(await mcpState()).toMatchObject({ sessions: 1, sessionStates: ['revoked'] });
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), saved);
  }
});

test('turned off, the process stops and the port closes', async () => {
  expect(await dispatch('mcp.setEnabled', { enabled: false })).toBe('ok');
  await expect.poll(() => utilityPid('mcp'), { timeout: 15_000 }).toBeUndefined();
  await expect.poll(() => listening(), { timeout: 5_000 }).toBe(false);
  expect(await mcpState()).toMatchObject({ enabled: false });
});
