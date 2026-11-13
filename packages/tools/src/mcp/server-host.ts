// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The local MCP server in the mcp utility process (P3-V4, D18): Streamable HTTP on 127.0.0.1 only, serving the
 * 2026-07-28 revision and, on the same path, 2025-era clients through the SDK's stateless fallback. It holds no
 * database, no keys and no tools: sessions come from the gateway's stream, tools and calls from the gateway, all
 * through main. It starts listening once the first session set has arrived (so no early request is refused as
 * unknown), reports listening / port_in_use / bind_failed to the gateway, and writes the endpoint file the stdio
 * shim reads.
 */
import { createServer, type Server } from 'node:http';
import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import { err, fromRpcError, ok, type AsyncResult, type Clock, type McpServerStatus } from '@taalcut/core';
import { removeEndpointFile, writeEndpointFile } from './endpoint-file';
import { McpBindFailed, McpPortInUse } from './errors';
import { createLegacySessions } from './legacy-sessions';
import { MCP_LIMITS, type McpLimits } from './limits';
import { createRateLimiter } from './rate';
import { sdkErrorLine } from './request-log';
import { createRequestPipeline } from './request-pipeline';
import { createSessionCache, type SessionCache } from './session-cache';
import type { McpGatewayClient } from './gateway-port';
import { createToolBridge } from './tool-bridge';

export interface McpServerHostDeps {
  readonly gateway: McpGatewayClient;
  readonly port: number;
  readonly clock: Clock;
  /** The app's version, as the server's name/version pair. */
  readonly version: string;
  /** `<userData>/mcp/endpoint.json`; none in tests that don't need it. */
  readonly endpointFile?: string;
  readonly limits?: McpLimits;
  readonly log?: (line: string) => void;
  readonly pid?: number;
}

export interface McpServerHost {
  start(): AsyncResult<{ readonly url: string }>;
  stop(): Promise<void>;
}

export function mcpUrl(port: number): string {
  return `http://127.0.0.1:${port}/mcp`;
}

function listen(server: Server, port: number): Promise<NodeJS.ErrnoException | undefined> {
  return new Promise((resolve) => {
    const onError = (error: NodeJS.ErrnoException) => resolve(error);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      resolve(undefined);
    });
  });
}

export function createMcpServerHost(deps: McpServerHostDeps): McpServerHost {
  const log = deps.log ?? ((line: string) => console.warn(line));
  const limits = deps.limits ?? MCP_LIMITS;
  const url = mcpUrl(deps.port);
  let server: Server | undefined;
  let handler: McpHttpHandler | undefined;
  let cache: SessionCache | undefined;

  const report = (status: McpServerStatus): void => {
    void deps.gateway.reportStatus(status).catch((cause: unknown) => {
      log(`[mcp] status not reported: ${fromRpcError(cause).code}`);
    });
  };

  return {
    async start() {
      const legacy = createLegacySessions(deps.clock);
      cache = createSessionCache({
        subscribe: (signal) => deps.gateway.sessions(undefined, { signal }),
        clock: deps.clock,
        log,
      });
      cache.onGone((sessionId) => legacy.dropSession(sessionId));
      await cache.ready();

      handler = createMcpHandler(
        createToolBridge({ gateway: deps.gateway, clock: deps.clock, version: deps.version }),
        {
          legacy: 'stateless',
          maxRequestBodySize: limits.maxBodyBytes,
          onerror: (error) => log(sdkErrorLine(error)),
        },
      );
      const pipeline = createRequestPipeline({
        port: deps.port,
        limits,
        sessions: cache,
        legacy,
        rate: createRateLimiter(deps.clock, limits),
        handler,
        touch: (sessionId, protocolSession) => {
          void deps.gateway
            .touch({ sessionId, ...(protocolSession ? { protocolSession } : {}) })
            .catch(() => undefined);
        },
        clock: deps.clock,
        log,
      });
      // Timeouts are checked every second (Node's default is every 30 s, which would stretch them by that much).
      // In the options, Node refuses a headers timeout longer than the request timeout (which then never fires).
      const http = createServer(
        {
          maxHeaderSize: limits.maxHeaderBytes,
          headersTimeout: limits.headersTimeoutMs,
          requestTimeout: limits.requestTimeoutMs,
          connectionsCheckingInterval: 1_000,
        },
        (req, res) => {
          pipeline(req, res).catch((cause: unknown) => {
            log(`[mcp] request failed: ${cause instanceof Error ? cause.name : 'unknown'}`);
            if (!res.headersSent) res.writeHead(500);
            res.end();
          });
        },
      );
      http.maxConnections = limits.maxSockets;
      http.keepAliveTimeout = limits.idleSocketMs;
      const failed = await listen(http, deps.port);
      if (failed) {
        const error =
          failed.code === 'EADDRINUSE'
            ? McpPortInUse({ port: deps.port })
            : McpBindFailed({ port: deps.port }, { detail: failed.code ?? failed.message });
        report({ state: 'error', port: deps.port, error });
        return err(error);
      }
      server = http;
      report({ state: 'listening', port: deps.port, url });
      log(`[mcp] listening on ${url}`);
      if (deps.endpointFile) {
        const written = await writeEndpointFile(deps.endpointFile, {
          url,
          pid: deps.pid ?? process.pid,
          startedAt: deps.clock.now(),
        });
        if (!written.ok) log(`[mcp] endpoint file not written: ${written.error.code}`);
      }
      return ok({ url });
    },
    async stop() {
      cache?.stop();
      if (deps.endpointFile) await removeEndpointFile(deps.endpointFile);
      const closing = server;
      server = undefined;
      if (closing) {
        await new Promise<void>((resolve) => {
          closing.close(() => resolve());
          closing.closeAllConnections();
        });
      }
      await handler?.close();
    },
  };
}
