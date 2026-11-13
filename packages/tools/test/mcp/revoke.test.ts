// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V4 Done when: "a revoked session is refused". Revoking from Settings (the person's `mcp.revokeSession`) makes
 * the very next request 401, cancels a call that is waiting for approval and expires that approval, and closes the
 * session's run. A rotated bearer ends the old one's 2025 protocol sessions (404), as the spec says for a session
 * the server has ended.
 */
import { MCP_COMMANDS } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ERAS, legacyClient } from './helpers/clients';
import { createWorld, waitFor, type World } from './helpers/world';

let world: World;

beforeEach(async () => {
  world = await createWorld({ holdMs: 5_000, progressEveryMs: 20 });
});

afterEach(async () => {
  await world.close();
});

function post(token: string, body: unknown, extra: Record<string, string> = {}): Promise<Response> {
  return fetch(world.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
      ...extra,
    },
    body: JSON.stringify(body),
  });
}

describe.each(ERAS)('revoking a %s client', (_era, connect) => {
  it('refuses the next request with 401 and cancels the call held for approval', async () => {
    const { sessionId, token } = await world.addSession('export');
    const client = await connect(world.url, token);
    try {
      await client.callTool('templates_breakdown', { reference: 'reel.mp4' });
      const held = client.callTool('render_export', { projectId: world.projectId, preset: 'reels' });
      await waitFor(() => world.runner.desk.list().some((approval) => approval.decision === 'pending'));

      await world.revoke(sessionId);
      const outcome = await held.then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );
      // The held call ends at once (cancelled), whatever shape the client gives it; nothing was exported.
      expect('error' in outcome || ('result' in outcome && outcome.result.isError === true)).toBe(true);
      expect(world.state.exports).toBe(0);
      expect(world.runner.desk.list()).toEqual([expect.objectContaining({ decision: 'expired' })]);
      expect(world.runner.closed.size).toBe(1);

      const next = await post(token, { jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} });
      expect(next.status).toBe(401);
      expect(next.headers.get('www-authenticate')).toBeNull();
      await expect(client.callTool('templates_breakdown', { reference: 'reel.mp4' })).rejects.toThrow();
      expect(world.gateway.state().sessions.find((s) => s.id === sessionId)?.status).toBe('revoked');
    } finally {
      await client.close().catch(() => undefined);
    }
  });
});

describe('a rotated bearer', () => {
  it('stops working, and its 2025 protocol session answers 404', async () => {
    const { sessionId, token } = await world.addSession('edit');
    const client = await legacyClient(world.url, token);
    const protocolSession = client.sessionId();
    expect(protocolSession).toMatch(/^[\x21-\x7e]{43}$/);
    try {
      const fresh = await world.rotate(sessionId);
      expect((await post(token, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })).status).toBe(
        401,
      );
      const stale = await post(
        fresh,
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
        { 'mcp-session-id': protocolSession ?? '' },
      );
      expect(stale.status).toBe(404);
      const without = await post(fresh, { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} });
      expect(without.status).toBe(200);
    } finally {
      await client.close().catch(() => undefined);
    }
  });

  it('ends a protocol session on DELETE, after which it is 404', async () => {
    const { token } = await world.addSession('read');
    const client = await legacyClient(world.url, token);
    const protocolSession = client.sessionId() ?? '';
    const ended = await fetch(world.url, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}`, 'mcp-session-id': protocolSession },
    });
    expect(ended.status).toBe(204);
    const again = await post(
      token,
      { jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} },
      { 'mcp-session-id': protocolSession },
    );
    expect(again.status).toBe(404);
    const unknown = await fetch(world.url, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}`, 'mcp-session-id': protocolSession },
    });
    expect(unknown.status).toBe(404);
  });
});

describe('who may manage sessions', () => {
  it.each(['agent', 'mcp'] as const)('refuses MCP commands from the %s source', async (source) => {
    const { sessionId } = await world.addSession('read');
    const refused = await world.bus.dispatch(
      MCP_COMMANDS.setSessionLevel,
      { sessionId, level: 'export' },
      { source, actor: `${source}:x` },
    );
    expect(!refused.ok && refused.error.code).toBe('core.command_source_refused');
  });
});
