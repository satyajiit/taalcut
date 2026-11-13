// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The one log line each MCP request writes: the session, the JSON-RPC method, the tool name, the status and the
 * time. Never the bearer, the arguments or the results. A method or tool name is logged only as far as it is made
 * of name characters, so a client can't write lines of its own into the log (security review SB-30); the SDK's
 * error lines are kept to one line the same way.
 */
import type { Clock, McpSessionId } from '@taalcut/core';
import { isPlainObject } from '../plain-object';

interface RequestWhat {
  readonly method: string;
  readonly tool?: string;
}

/** A client-chosen name as the log may show it: name characters only, at most 64 of them. */
function loggable(name: string): string {
  const safe = /^[A-Za-z0-9_./$-]{1,64}$/.test(name);
  return safe ? name : '(odd name)';
}

/** The JSON-RPC method and, for tools/call, the tool name: for the log line only. */
export function describeBody(body: unknown): RequestWhat {
  if (!isPlainObject(body)) return { method: Array.isArray(body) ? 'batch' : '-' };
  const method = typeof body['method'] === 'string' ? body['method'] : 'response';
  const params = body['params'];
  const name = method === 'tools/call' && isPlainObject(params) ? params['name'] : undefined;
  return { method: loggable(method), ...(typeof name === 'string' ? { tool: loggable(name) } : {}) };
}

/**
 * An error the SDK reports (its `onerror`), as one bounded line. Its texts can quote what a client sent (an id, a
 * schema issue printed over several lines), so control and line-separator characters become spaces.
 */
export function sdkErrorLine(error: Error): string {
  const text = `${error.name}: ${error.message.slice(0, 200)}`;
  return `[mcp] ${text.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ')}`;
}

export interface RequestLog {
  /** Filled in as the request is understood. */
  session?: McpSessionId;
  what: RequestWhat;
  /** Writes the line with this status. */
  finish(status: number): void;
}

export function startRequestLog(
  deps: { readonly clock: Clock; readonly log: (line: string) => void },
  method: string | undefined,
): RequestLog {
  const started = deps.clock.now();
  const line: RequestLog = {
    what: { method: method ?? '-' },
    finish(status) {
      const { session, what } = line;
      deps.log(
        `[mcp] ${session ?? '-'} ${what.method}${what.tool ? ` ${what.tool}` : ''} ${status} ${deps.clock.now() - started}ms`,
      );
    },
  };
  return line;
}
