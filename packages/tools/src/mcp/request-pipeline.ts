// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One HTTP request through the local MCP server, in order: the guard (path, method, Host, Origin, media types,
 * declared size), the bearer (401 with no OAuth hints), the session's rate (429), the body (size, JSON, depth),
 * the protocol revision, 2025 protocol-session bookkeeping (404 for one that ended), then the SDK handler.
 * Each request writes one log line (request-log.ts). A request refused before its body is read keeps its socket at
 * most a second longer (refusal.ts), so a body sent slowly can't hold it.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isLegacyRequest, type McpHttpHandler } from '@modelcontextprotocol/server';
import { withinJsonLimits, type Clock, type McpSessionId } from '@taalcut/core';
import { bearerToken, tokenHash } from './bearer';
import { guardRequest, type Rejection } from './http-guard';
import type { LegacySessions } from './legacy-sessions';
import { LEGACY_PROTOCOLS, MODERN_PROTOCOL, type McpLimits } from './limits';
import type { RateLimiter } from './rate';
import { jsonRpcError, reject, tooManyRequests, UNKNOWN_BEARER } from './refusal';
import { readBody, sdkRequest, single, writeResponse } from './request-io';
import { describeBody, startRequestLog, type RequestLog } from './request-log';
import type { CachedSession, SessionCache } from './session-cache';

export interface PipelineDeps {
  readonly port: number;
  readonly limits: McpLimits;
  readonly sessions: Pick<SessionCache, 'lookup'>;
  readonly legacy: LegacySessions;
  readonly rate: RateLimiter;
  readonly handler: Pick<McpHttpHandler, 'fetch'>;
  /** Last-used bookkeeping (gateway.touch); never awaited by the request. */
  readonly touch: (sessionId: McpSessionId, protocolSession?: string) => void;
  readonly clock: Clock;
  readonly log: (line: string) => void;
}

/** A request whose bearer named a live session and whose rate was admitted. */
interface Exchange {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly found: CachedSession;
  readonly log: RequestLog;
  /** The 2025 protocol session the client named (`MCP-Session-Id`), if any. */
  readonly protocolSession: string | undefined;
}

/** A POST whose body was read and parsed. */
interface Posted {
  readonly text: string;
  readonly body: unknown;
}

function sessionOf(deps: PipelineDeps, req: IncomingMessage): CachedSession | undefined {
  const token = bearerToken(req.headers.authorization);
  return token ? deps.sessions.lookup(tokenHash(token)) : undefined;
}

function parseJson(text: string): { readonly value: unknown } | undefined {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return undefined;
  }
}

/**
 * DELETE ends a 2025 protocol session of this bearer's session: 204, else 404. Its body is never read, so the
 * guard's size check doesn't apply and the answer lingers like a refusal (a body sent slowly can't hold the socket).
 */
function endProtocolSession(deps: PipelineDeps, ex: Exchange): number {
  ex.log.what = { method: 'DELETE' };
  const ended = ex.protocolSession !== undefined && deps.legacy.end(ex.protocolSession, ex.found.sessionId);
  return reject(ex.res, { status: ended ? 204 : 404 }, true);
}

/** Why a request of this protocol revision, or for this 2025 protocol session, is refused; undefined when it isn't. */
function protocolRefusal(
  deps: PipelineDeps,
  ex: Exchange,
  legacy: boolean,
  version: string | null,
): Rejection | undefined {
  const versionOk = legacy ? version === null || LEGACY_PROTOCOLS.has(version) : version === MODERN_PROTOCOL;
  if (!versionOk) return { status: 400, body: jsonRpcError(-32600, 'Unsupported MCP-Protocol-Version') };
  const ended =
    legacy &&
    ex.protocolSession !== undefined &&
    deps.legacy.check(ex.protocolSession, ex.found.sessionId) !== 'ok';
  return ended ? { status: 404, body: jsonRpcError(-32001, 'Session not found') } : undefined;
}

/** Hands the request to the SDK as this session (never with its bearer) and streams the answer back. */
async function forward(deps: PipelineDeps, ex: Exchange, posted: Posted): Promise<number> {
  const request = sdkRequest(ex.req, ex.res, deps.port, posted.text);
  const legacy = await isLegacyRequest(request, posted.body, {
    maxRequestBodySize: deps.limits.maxBodyBytes,
  });
  const refused = protocolRefusal(deps, ex, legacy, request.headers.get('mcp-protocol-version'));
  if (refused) return reject(ex.res, refused);

  const { sessionId, level } = ex.found;
  deps.touch(sessionId, legacy ? ex.protocolSession : undefined);
  const response = await deps.handler.fetch(request, {
    parsedBody: posted.body,
    authInfo: { token: '', clientId: sessionId, scopes: [level], extra: { sessionId, level } },
  });
  const minted =
    legacy && ex.log.what.method === 'initialize' && response.status === 200
      ? deps.legacy.mint(sessionId)
      : undefined;
  await writeResponse(ex.res, response, minted ? { 'mcp-session-id': minted } : {});
  return response.status;
}

/** An admitted request: DELETE, or a POST whose body must be within the size, JSON and depth limits. */
async function serve(deps: PipelineDeps, ex: Exchange): Promise<number> {
  if ((ex.req.method ?? '').toUpperCase() === 'DELETE') return endProtocolSession(deps, ex);
  const text = await readBody(ex.req, deps.limits.maxBodyBytes);
  if (text === undefined) return reject(ex.res, { status: 413 }, true);
  const parsed = parseJson(text);
  if (!parsed) return reject(ex.res, { status: 400, body: jsonRpcError(-32700, 'Parse error') });
  ex.log.what = describeBody(parsed.value);
  const limits = { maxBytes: deps.limits.maxBodyBytes, maxDepth: deps.limits.maxJsonDepth };
  if (!withinJsonLimits(parsed.value, limits)) return reject(ex.res, { status: 413 });
  return forward(deps, ex, { text, body: parsed.value });
}

export function createRequestPipeline(deps: PipelineDeps) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const log = startRequestLog(deps, req.method);
    const guarded = guardRequest(req, deps.port, deps.limits.maxBodyBytes);
    if (guarded) return log.finish(reject(res, guarded, true));

    const found = sessionOf(deps, req);
    if (!found) return log.finish(reject(res, UNKNOWN_BEARER, true));
    log.session = found.sessionId;

    const admitted = deps.rate.admit(found.sessionId);
    if (!admitted.ok) return log.finish(reject(res, tooManyRequests(admitted.retryAfterSeconds), true));
    try {
      const protocolSession = single(req.headers['mcp-session-id']);
      log.finish(await serve(deps, { req, res, found, log, protocolSession }));
    } finally {
      admitted.release();
    }
  };
}
