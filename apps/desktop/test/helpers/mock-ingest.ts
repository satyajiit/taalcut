// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Loopback HTTP ingest for crash and feedback envelopes. No network. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gunzipSync } from 'node:zlib';

export interface IngestRequest {
  readonly method: string;
  readonly url: string;
  readonly contentType: string;
  /** The body as sent, gunzipped when it came with `content-encoding: gzip` (Crashpad's uploads do). */
  readonly body: Buffer;
}

export interface MockIngest {
  readonly port: number;
  readonly dsn: string;
  /** Raw bodies, in arrival order. */
  readonly bodies: Buffer[];
  readonly requests: IngestRequest[];
  close(): Promise<void>;
}

export function startIngest(): Promise<MockIngest> {
  const bodies: Buffer[] = [];
  const requests: IngestRequest[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      bodies.push(raw);
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        contentType: req.headers['content-type'] ?? '',
        body: req.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        port: address.port,
        dsn: `http://testkey@127.0.0.1:${address.port}/1`,
        bodies,
        requests,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}
