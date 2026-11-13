// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The MCP server's log lines (security review SB-30): one line per request naming the session, method, tool,
 * status and time, client-chosen names reduced to name characters, and the SDK's own error lines kept to one line.
 */
import { describe, expect, it } from 'vitest';
import type { McpSessionId } from '@taalcut/core';
import { describeBody, sdkErrorLine, startRequestLog } from '../../src/mcp/request-log';

describe('describeBody', () => {
  it('names the method and, for tools/call, the tool', () => {
    expect(describeBody({ method: 'tools/call', params: { name: 'render_export' } })).toEqual({
      method: 'tools/call',
      tool: 'render_export',
    });
    expect(describeBody({ method: 'tools/list', params: { name: 'ignored' } })).toEqual({
      method: 'tools/list',
    });
  });

  it('says batch, response or - for bodies that are not one request', () => {
    expect(describeBody([{ method: 'tools/list' }])).toEqual({ method: 'batch' });
    expect(describeBody({ id: 1, result: {} })).toEqual({ method: 'response' });
    expect(describeBody(null)).toEqual({ method: '-' });
    expect(describeBody('tools/list')).toEqual({ method: '-' });
  });

  it('logs a name only as far as it is made of name characters', () => {
    const forged = 'tools/list\n[mcp] forged';
    expect(describeBody({ method: forged })).toEqual({ method: '(odd name)' });
    expect(describeBody({ method: 'tools/call', params: { name: 'x'.repeat(65) } })).toEqual({
      method: 'tools/call',
      tool: '(odd name)',
    });
  });
});

describe('sdkErrorLine', () => {
  it('keeps an error that quotes a client to one bounded line', () => {
    const error = new Error(
      `Received a response for an unknown request id: 1\r\n[mcp] forged\u2028${'y'.repeat(500)}`,
    );
    const line = sdkErrorLine(error);
    expect(line.startsWith('[mcp] Error: Received a response')).toBe(true);
    expect(line).not.toMatch(/[\r\n\u2028\u2029]/);
    expect(line.length).toBeLessThanOrEqual(220);
  });
});

describe('startRequestLog', () => {
  it('writes the session, method, tool, status and time once finished', () => {
    let now = 1_000;
    const lines: string[] = [];
    const log = startRequestLog({ clock: { now: () => now }, log: (line) => lines.push(line) }, 'POST');
    log.finish(403);
    log.session = '01M5000000000000000000000S' as McpSessionId;
    log.what = { method: 'tools/call', tool: 'render_export' };
    now = 1_012;
    log.finish(200);
    expect(lines).toEqual([
      '[mcp] - POST 403 0ms',
      '[mcp] 01M5000000000000000000000S tools/call render_export 200 12ms',
    ]);
  });
});
