// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * External agents as the agent and main serve them (P3-V4): `mcp.state`/`mcp.changed` (the agent's view of the
 * sessions, never a token hash), MCP_COMMANDS on the bus (person sources only, as the gateway registers them),
 * and `mcpSetup` (main: it mints the bearer, hands the agent only its hash over mcpSessions, never the bus, and
 * writes the setup text to the clipboard itself). The fake keeps that clipboard in `clipboard` for tests; no
 * procedure returns it, and the page only ever learns an opaque session id.
 */
import {
  defineCommand,
  err,
  MCP_COMMANDS,
  MCP_DEFAULT_PORT,
  MCP_SESSION_IDLE_EXPIRY_MS,
  mcpCommandPayloads,
  newId,
  NotFoundError,
  ok,
  PERSON_SOURCES,
  toRpcError,
  type AnyCommand,
  type McpClientKind,
  type McpLevel,
  type McpSessionId,
  type McpSessionRecord,
  type McpSessionView,
  type McpSetupFormat,
  type McpState,
} from '@taalcut/core';
import { watched, type Watched } from '../watch';

export const MCP_SCENARIOS = ['off', 'on', 'sessions', 'error'] as const;
export type McpScenario = (typeof MCP_SCENARIOS)[number];

export interface FakeMcpOptions {
  /** off (the default, D18), on with no sessions, on with sessions, or the server failing to start. */
  readonly scenario?: McpScenario;
  /** Milliseconds from switching on to listening; 0 is at once. */
  readonly startMs?: number;
}

export interface ClipboardWrite {
  readonly sessionId: McpSessionId;
  readonly format: McpSetupFormat;
  /** What main put on the clipboard: the bearer is inside, so it never reaches the page. */
  readonly text: string;
}

export interface FakeMcp {
  readonly watch: Watched<McpState>;
  readonly clipboard: ClipboardWrite[];
  commands(): AnyCommand[];
  createSession(input: {
    name: string;
    client: McpClientKind;
    level: McpLevel;
    copy: McpSetupFormat;
  }): Promise<{ sessionId: McpSessionId; copied: McpSetupFormat }>;
  copySetup(input: { sessionId: McpSessionId; format: McpSetupFormat }): { copied: McpSetupFormat };
  rotateToken(input: { sessionId: McpSessionId; copy: McpSetupFormat }): Promise<{ copied: McpSetupFormat }>;
}

const ACTIVE_WITHIN_MS = 5 * 60_000;
const HEX = '0123456789abcdef';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const random = (alphabet: string, length: number) =>
  Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');

/* eslint-disable lingui/no-unlocalized-strings -- the setup text main writes to the clipboard: config, not UI */
function setupText(format: McpSetupFormat, port: number, token: string): string {
  const url = `http://127.0.0.1:${port}/mcp`;
  if (format === 'claude-http')
    return `claude mcp add --transport http taalcut ${url} --header "Authorization: Bearer ${token}"`;
  if (format === 'codex-http') return `[mcp_servers.taalcut]\nurl = "${url}"\nbearer_token = "${token}"`;
  return `TAALCUT_MCP_TOKEN=${token} /Applications/Taalcut.app/Contents/Resources/bin/taalcut mcp`;
}

function seedSessions(now: number): McpSessionRecord[] {
  type Seed = Pick<McpSessionRecord, 'name' | 'client' | 'level'> & {
    readonly agoMs: number;
    readonly usedAgoMs: number | null;
    readonly revoked?: boolean;
  };
  const session = ({ name, client, level, agoMs, usedAgoMs, revoked = false }: Seed): McpSessionRecord => ({
    id: newId<'McpSession'>(),
    name,
    client,
    level,
    tokenHash: random(HEX, 64),
    createdAt: now - agoMs,
    lastUsedAt: usedAgoMs === null ? null : now - usedAgoMs,
    revokedAt: revoked ? now - 3_600_000 : null,
    runId: newId<'AgentRun'>(),
    conversationId: newId<'Conversation'>(),
  });
  const day = 86_400_000;
  return [
    session({ name: 'Claude Code', client: 'claude-code', level: 'edit', agoMs: 6 * day, usedAgoMs: 60_000 }),
    session({
      name: 'Codex on the laptop',
      client: 'codex',
      level: 'read',
      agoMs: 12 * day,
      usedAgoMs: 2 * day,
    }),
    session({
      name: 'Old script',
      client: 'other',
      level: 'export',
      agoMs: 30 * day,
      usedAgoMs: 20 * day,
      revoked: true,
    }),
  ];
}
/* eslint-enable lingui/no-unlocalized-strings */

export function createFakeMcp(now: () => number, options: FakeMcpOptions = {}): FakeMcp {
  const scenario = options.scenario ?? 'off';
  let enabled = scenario !== 'off';
  let port = MCP_DEFAULT_PORT;
  let server: McpState['server'] =
    scenario === 'error'
      ? {
          state: 'error',
          port,
          error: { code: 'mcp.port_in_use', messageKey: 'errors.mcp.port_in_use', retryable: true },
        }
      : enabled
        ? { state: 'listening', port, url: `http://127.0.0.1:${port}/mcp` }
        : { state: 'off', port };
  const sessions: McpSessionRecord[] = scenario === 'sessions' ? seedSessions(now()) : [];
  const calls = new Map<string, number>(sessions.map((s, i) => [s.id, [14, 3, 0][i] ?? 0]));
  const tokens = new Map<string, string>();
  const clipboard: ClipboardWrite[] = [];

  const view = (record: McpSessionRecord): McpSessionView => {
    const used = record.lastUsedAt ?? record.createdAt;
    const status = record.revokedAt
      ? 'revoked'
      : now() - used > MCP_SESSION_IDLE_EXPIRY_MS
        ? 'expired'
        : record.lastUsedAt !== null && now() - record.lastUsedAt < ACTIVE_WITHIN_MS
          ? 'active'
          : 'idle';
    // The view never carries the token's hash.
    return {
      id: record.id,
      name: record.name,
      client: record.client,
      level: record.level,
      createdAt: record.createdAt,
      lastUsedAt: record.lastUsedAt,
      revokedAt: record.revokedAt,
      runId: record.runId,
      conversationId: record.conversationId,
      status,
      callsToday: calls.get(record.id) ?? 0,
      pendingApprovals: 0,
    };
  };
  const watch = watched<McpState>(() => ({ enabled, server: { ...server }, sessions: sessions.map(view) }));

  const listen = () => {
    server = { state: 'listening', port, url: `http://127.0.0.1:${port}/mcp` };
    watch.notify();
  };
  const start = () => {
    server = { state: 'starting', port };
    const ms = options.startMs ?? 300;
    if (ms > 0) setTimeout(listen, ms);
    else listen();
  };
  const find = (id: McpSessionId) => sessions.find((session) => session.id === id);
  const missing = (id: McpSessionId) => err(NotFoundError({ entity: 'mcpSession', id }));
  const remember = (sessionId: McpSessionId, format: McpSetupFormat) => {
    const token = tokens.get(sessionId) ?? `tcm_${random(B64, 43)}`;
    tokens.set(sessionId, token);
    clipboard.push({ sessionId, format, text: setupText(format, port, token) });
  };

  const P = mcpCommandPayloads;
  const person = { sideEffect: 'write' as const, sources: PERSON_SOURCES, project: () => null };
  const commands = (): AnyCommand[] => [
    defineCommand({
      name: MCP_COMMANDS.setEnabled,
      payload: P[MCP_COMMANDS.setEnabled],
      ...person,
      handle({ enabled: next }) {
        enabled = next;
        if (next) start();
        else server = { state: 'off', port };
        watch.notify();
        return ok({ result: { enabled } });
      },
    }),
    defineCommand({
      name: MCP_COMMANDS.setPort,
      payload: P[MCP_COMMANDS.setPort],
      ...person,
      handle({ port: next }) {
        const before = port;
        port = next;
        if (enabled) start();
        watch.notify();
        return ok({ result: { port }, inverse: { name: MCP_COMMANDS.setPort, payload: { port: before } } });
      },
    }),
    defineCommand({
      name: MCP_COMMANDS.setSessionLevel,
      payload: P[MCP_COMMANDS.setSessionLevel],
      ...person,
      handle({ sessionId, level }) {
        const session = find(sessionId);
        if (!session) return missing(sessionId);
        const before = session.level;
        session.level = level;
        watch.notify();
        return ok({
          result: { sessionId, level },
          inverse: { name: MCP_COMMANDS.setSessionLevel, payload: { sessionId, level: before } },
        });
      },
    }),
    defineCommand({
      name: MCP_COMMANDS.renameSession,
      payload: P[MCP_COMMANDS.renameSession],
      ...person,
      handle({ sessionId, name }) {
        const session = find(sessionId);
        if (!session) return missing(sessionId);
        const before = session.name;
        session.name = name;
        watch.notify();
        return ok({
          result: { sessionId, name },
          inverse: { name: MCP_COMMANDS.renameSession, payload: { sessionId, name: before } },
        });
      },
    }),
    defineCommand({
      name: MCP_COMMANDS.revokeSession,
      payload: P[MCP_COMMANDS.revokeSession],
      ...person,
      sideEffect: 'destructive',
      handle({ sessionId }) {
        const session = find(sessionId);
        if (!session) return missing(sessionId);
        session.revokedAt = now();
        tokens.delete(sessionId);
        watch.notify();
        return ok({ result: { sessionId } });
      },
    }),
  ];

  // Main hands the agent a new session's hash over mcpSessions (main → agent, round P3-2): never a bus command,
  // so no window, agent or MCP client can register a bearer it chose.
  const addSession = (record: {
    sessionId: McpSessionId;
    name: string;
    client: McpClientKind;
    level: McpLevel;
  }) => {
    sessions.unshift({
      id: record.sessionId,
      name: record.name,
      client: record.client,
      level: record.level,
      tokenHash: random(HEX, 64),
      createdAt: now(),
      lastUsedAt: null,
      revokedAt: null,
      runId: newId<'AgentRun'>(),
      conversationId: newId<'Conversation'>(),
    });
    watch.notify();
  };
  const rotateHash = (sessionId: McpSessionId) => {
    const session = find(sessionId);
    if (!session || session.revokedAt)
      throw toRpcError(NotFoundError({ entity: 'mcpSession', id: sessionId }));
    session.tokenHash = random(HEX, 64);
    watch.notify();
  };

  return {
    watch,
    clipboard,
    commands,
    createSession({ name, client, level, copy }) {
      const sessionId = newId<'McpSession'>();
      addSession({ sessionId, name, client, level });
      remember(sessionId, copy);
      return Promise.resolve({ sessionId, copied: copy });
    },
    copySetup({ sessionId, format }) {
      const session = find(sessionId);
      if (!session || session.revokedAt)
        throw toRpcError(NotFoundError({ entity: 'mcpSession', id: sessionId }));
      remember(sessionId, format);
      return { copied: format };
    },
    rotateToken({ sessionId, copy }) {
      rotateHash(sessionId);
      tokens.delete(sessionId);
      remember(sessionId, copy);
      return Promise.resolve({ copied: copy });
    },
  };
}
