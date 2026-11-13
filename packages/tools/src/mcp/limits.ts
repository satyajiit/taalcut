// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The local MCP server's limits (tools SPEC, "The HTTP surface"). A local process can still reach a loopback
 * port, so every request is bounded before anything parses it.
 */
export interface McpLimits {
  /** POST body. */
  readonly maxBodyBytes: number;
  readonly maxJsonDepth: number;
  /** Calls running at once per session. */
  readonly maxConcurrentCalls: number;
  /** Requests per session in a sliding minute. */
  readonly requestsPerMinute: number;
  readonly maxSockets: number;
  readonly maxHeaderBytes: number;
  readonly headersTimeoutMs: number;
  /** The whole request (headers and body) must arrive within this; a trickled body can't hold a socket. */
  readonly requestTimeoutMs: number;
  /** Idle keep-alive sockets are closed after this. */
  readonly idleSocketMs: number;
}

export const MCP_LIMITS: McpLimits = {
  maxBodyBytes: 1024 * 1024,
  maxJsonDepth: 32,
  maxConcurrentCalls: 8,
  requestsPerMinute: 300,
  maxSockets: 64,
  maxHeaderBytes: 16 * 1024,
  headersTimeoutMs: 15_000,
  requestTimeoutMs: 30_000,
  idleSocketMs: 120_000,
};

/** The revision Claude Code's v2 runtime negotiates: no protocol session, every request self-describing. */
export const MODERN_PROTOCOL = '2026-07-28';
/**
 * 2025-era revisions a client may have negotiated in `initialize` and then names on every request. Streamable
 * HTTP exists from 2025-03-26; older revisions spoke the deprecated HTTP+SSE transport.
 */
export const LEGACY_PROTOCOLS: ReadonlySet<string> = new Set(['2025-11-25', '2025-06-18', '2025-03-26']);
