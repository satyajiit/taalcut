// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * External agents' setup in main (P3-V4): the four setup texts, main minting the bearer and sending the agent only
 * its hash, the clipboard as the only place a token goes, the vault entry kept for "Copy setup" and dropped after a
 * revoke, and a rotation that keeps the old key when the agent refuses the new one.
 */
import {
  createEventBus,
  createMemorySettingsStore,
  err,
  MCP_COMMANDS,
  MCP_SESSIONS_SETTING,
  MCP_TOKEN_HASH_PATTERN,
  MCP_TOKEN_PATTERN,
  newId,
  ok,
  ValidationError,
  type AsyncResult,
  type McpSessionRecord,
} from '@taalcut/core';
import { createMemorySecretStore } from '@taalcut/models';
import { tokenHash } from '@taalcut/tools';
import { describe, expect, it } from 'vitest';
import { createMcpSetup } from '../src/main/mcp/mcp-setup-router';
import type { McpSessionHashes } from '../src/main/mcp/session-hashes';
import { setupText } from '../src/main/mcp/setup-text';
import { forgetRevokedTokens, mcpVaultKey, mintMcpToken } from '../src/main/mcp/tokens';

const TOKEN = `tcm_${'A'.repeat(43)}`;
const SHIM = '/Applications/Taalcut.app/Contents/Resources/bin/taalcut';

describe('setup text', () => {
  const text = (format: Parameters<typeof setupText>[0]['format']) =>
    setupText({ format, port: 41730, token: TOKEN, shimPath: SHIM });

  it('gives Claude Code one line over HTTP, always with the bearer header and 127.0.0.1', () => {
    expect(text('claude-http')).toBe(
      `claude mcp add --transport http taalcut --scope user http://127.0.0.1:41730/mcp --header "Authorization: Bearer ${TOKEN}"\n`,
    );
  });

  it('gives Claude Code the shim with the token in its environment', () => {
    expect(text('claude-stdio')).toBe(
      `claude mcp add --transport stdio taalcut --scope user --env TAALCUT_MCP_TOKEN=${TOKEN} -- "${SHIM}" mcp\n`,
    );
    expect(setupText({ format: 'claude-stdio', port: 1, token: TOKEN, shimPath: '/A "b"/$x' })).toContain(
      '"/A \\"b\\"/\\$x" mcp',
    );
  });

  it('gives Codex config.toml blocks for HTTP and the shim', () => {
    expect(text('codex-http')).toBe(
      [
        '[mcp_servers.taalcut]',
        'url = "http://127.0.0.1:41730/mcp"',
        `http_headers = { Authorization = "Bearer ${TOKEN}" }`,
        'startup_timeout_sec = 20',
        'tool_timeout_sec = 60',
        'default_tools_approval_mode = "writes"',
        '',
      ].join('\n'),
    );
    expect(text('codex-stdio')).toBe(
      [
        '[mcp_servers.taalcut]',
        `command = "${SHIM}"`,
        'args = ["mcp"]',
        'startup_timeout_sec = 20',
        '',
        '[mcp_servers.taalcut.env]',
        `TAALCUT_MCP_TOKEN = "${TOKEN}"`,
        '',
      ].join('\n'),
    );
  });
});

/** What main handed the agent (the mcpSessions procedure and its input). */
interface Dispatched {
  readonly name: 'add' | 'rotate';
  readonly payload: unknown;
}

function setup(answer: (name: Dispatched['name']) => AsyncResult<unknown> = async () => ok({})) {
  const vault = createMemorySecretStore();
  const dispatched: Dispatched[] = [];
  const clipboard: string[] = [];
  const cleared: string[] = [];
  const timers: { run: () => void; ms: number }[] = [];
  let minted = 0;
  const service = createMcpSetup({
    vault,
    sessions: {
      add: (payload) => {
        dispatched.push({ name: 'add', payload });
        return answer('add');
      },
      rotate: (payload) => {
        dispatched.push({ name: 'rotate', payload });
        return answer('rotate');
      },
    } satisfies McpSessionHashes,
    port: () => 41730,
    shimPath: SHIM,
    clipboard: {
      writeText: (text) => void clipboard.push(text),
      readText: () => clipboard.at(-1) ?? '',
      clear: () => void cleared.push(clipboard.at(-1) ?? ''),
    },
    mint: () => `tcm_${String((minted += 1)).padStart(43, 'k')}`,
    schedule: (run, ms) => void timers.push({ run, ms }),
  });
  return { vault, dispatched, clipboard, cleared, timers, service };
}

describe('sessions set up by main', () => {
  it('mints a 256-bit tcm_ bearer', () => {
    const tokens = new Set(Array.from({ length: 50 }, mintMcpToken));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token).toMatch(MCP_TOKEN_PATTERN);
  });

  it('sends the agent the hash, keeps the bearer in the vault, and copies it, returning no token', async () => {
    const { vault, dispatched, clipboard, service } = setup();
    const created = await service.createSession({
      name: 'Claude Code on this Mac',
      client: 'claude-code',
      level: 'edit',
      copy: 'claude-http',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const token = `tcm_${'1'.padStart(43, 'k')}`;
    expect(dispatched).toEqual([
      {
        name: 'add',
        payload: {
          sessionId: created.value.sessionId,
          name: 'Claude Code on this Mac',
          client: 'claude-code',
          level: 'edit',
          tokenHash: tokenHash(token),
        },
      },
    ]);
    expect(JSON.stringify(dispatched)).not.toContain(token);
    expect(tokenHash(token)).toMatch(MCP_TOKEN_HASH_PATTERN);
    expect(JSON.stringify(created.value)).not.toContain('tcm_');
    expect(clipboard).toEqual([expect.stringContaining(`Bearer ${token}`)]);
    expect(await vault.get(mcpVaultKey(created.value.sessionId))).toEqual(ok(token));

    const again = await service.copySetup({ sessionId: created.value.sessionId, format: 'codex-stdio' });
    expect(again).toEqual(ok({ copied: 'codex-stdio' }));
    expect(clipboard[1]).toContain(`TAALCUT_MCP_TOKEN = "${token}"`);
  });

  it('clears the setup text from the clipboard two minutes later, unless something else was copied', async () => {
    const { clipboard, cleared, timers, service } = setup();
    await service.createSession({ name: 'A', client: 'codex', level: 'read', copy: 'codex-http' });
    expect(timers.map((timer) => timer.ms)).toEqual([120_000]);
    timers[0]?.run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cleared).toEqual([clipboard[0]]);

    const created = await service.createSession({
      name: 'B',
      client: 'codex',
      level: 'read',
      copy: 'codex-http',
    });
    clipboard.push('something the person copied since');
    timers[1]?.run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(created.ok).toBe(true);
    expect(cleared).toHaveLength(1);
  });

  it('forgets the bearer when the agent refuses the session', async () => {
    const { vault, clipboard, service } = setup(async () =>
      err(ValidationError({ field: 'sessionId' }, { detail: 'x' })),
    );
    const created = await service.createSession({
      name: 'X',
      client: 'other',
      level: 'read',
      copy: 'claude-http',
    });
    expect(!created.ok && created.error.code).toBe('core.validation');
    expect(vault.entries.size).toBe(0);
    expect(clipboard).toEqual([]);
  });

  it('says the key is missing when the vault lost it', async () => {
    const { service } = setup();
    const copied = await service.copySetup({ sessionId: newId<'McpSession'>(), format: 'claude-http' });
    expect(!copied.ok && copied.error.code).toBe('desktop.mcp_token_missing');
  });

  it('rotates to a new bearer, and keeps the old one if the agent refuses the new', async () => {
    let refuse = false;
    const { vault, dispatched, clipboard, service } = setup(async (name) =>
      refuse && name === 'rotate' ? err(ValidationError({ field: 'tokenHash' })) : ok({}),
    );
    const created = await service.createSession({
      name: 'C',
      client: 'codex',
      level: 'read',
      copy: 'codex-http',
    });
    if (!created.ok) throw new Error('not created');
    const { sessionId } = created.value;
    const rotated = await service.rotateToken({ sessionId, copy: 'claude-stdio' });
    expect(rotated).toEqual(ok({ copied: 'claude-stdio' }));
    const second = `tcm_${'2'.padStart(43, 'k')}`;
    expect(dispatched[1]).toEqual({
      name: 'rotate',
      payload: { sessionId, tokenHash: tokenHash(second) },
    });
    expect(clipboard[1]).toContain(`TAALCUT_MCP_TOKEN=${second}`);

    refuse = true;
    const refused = await service.rotateToken({ sessionId, copy: 'claude-http' });
    expect(refused.ok).toBe(false);
    expect(await vault.get(mcpVaultKey(sessionId))).toEqual(ok(second));
    expect(clipboard).toHaveLength(2);
  });
});

describe('the vault after a revoke', () => {
  it('drops the bearers of revoked sessions once the revoke commits', async () => {
    const vault = createMemorySecretStore();
    const settings = createMemorySettingsStore();
    const events = createEventBus({ clock: { now: () => 1 } });
    const live = newId<'McpSession'>();
    const gone = newId<'McpSession'>();
    const record = (id: typeof live, revokedAt: number | null): McpSessionRecord => ({
      id,
      name: 'S',
      client: 'other',
      level: 'read',
      tokenHash: (id === live ? 'a' : 'b').repeat(64),
      createdAt: 1,
      lastUsedAt: null,
      revokedAt,
      runId: newId<'AgentRun'>(),
      conversationId: newId<'Conversation'>(),
    });
    await vault.set(mcpVaultKey(live), TOKEN);
    await vault.set(mcpVaultKey(gone), TOKEN);
    await settings.set(MCP_SESSIONS_SETTING, [record(live, null), record(gone, 5)]);
    const stop = forgetRevokedTokens({ events, settings, vault, log: () => undefined });
    events.emit('command.changed', {
      kind: 'executed',
      id: newId<'Command'>(),
      name: MCP_COMMANDS.revokeSession,
      projectId: null,
      source: 'ui',
      actor: 'user',
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect([...vault.entries.keys()]).toEqual([mcpVaultKey(live)]);
    stop();
  });
});
