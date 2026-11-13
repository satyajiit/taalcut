// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A loopback HTTP server for stock downloads: recorded bodies, no provider is called. */
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';

export interface Hit {
  readonly url: string | undefined;
  readonly authorization: string | undefined;
}

export interface Route {
  readonly type: string;
  readonly body: Uint8Array;
  /** Sent in pieces with no Content-Length, as a chunked response arrives. */
  readonly chunked?: boolean;
}

function portOf(server: Server): number {
  const address = server.address();
  if (address && typeof address === 'object') return address.port;
  throw new Error('stock test server has no port');
}

export async function withServer(
  routes: Record<string, Route>,
  run: (origin: string, hits: Hit[]) => Promise<void>,
): Promise<void> {
  const hits: Hit[] = [];
  const server = createServer((req, res) => {
    hits.push({ url: req.url, authorization: req.headers.authorization });
    const route = routes[req.url ?? ''];
    if (!route) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': route.type });
    if (!route.chunked) {
      res.end(route.body);
      return;
    }
    for (let offset = 0; offset < route.body.byteLength; offset += 8) {
      res.write(route.body.subarray(offset, offset + 8));
    }
    res.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${portOf(server)}`, hits);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
