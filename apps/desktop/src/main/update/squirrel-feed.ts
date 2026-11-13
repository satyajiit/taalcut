// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The feed Squirrel.Mac stages a verified update from: a loopback server
 * that answers its JSON feed request with the zip's URL and serves the
 * snapshot (snapshot.ts), not the update library's cache file. Both paths
 * carry a random token, and the zip is let out only while it still has the
 * hash it was verified with.
 */
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pipeline } from 'node:stream';
import { releaseIfUnchanged, type Snapshot } from './snapshot';

export interface SquirrelFeed {
  /** For autoUpdater.setFeedURL: answers with {"url": <the zip>}. */
  readonly url: string;
  close(): void;
}

export function serveToSquirrel(snapshot: Snapshot): Promise<SquirrelFeed> {
  const token = randomBytes(32).toString('hex');
  const feedPath = `/${token}/feed`;
  const zipPath = `/${token}/update.zip`;
  const server = createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405).end();
      return;
    }
    if (request.url === feedPath) {
      const body = JSON.stringify({ url: `${origin()}${zipPath}` });
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
      });
      response.end(body);
      return;
    }
    if (request.url !== zipPath) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': snapshot.size });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    // On a mismatch pipeline destroys the response, so Squirrel gets a short, failed download.
    pipeline(createReadStream(snapshot.path), releaseIfUnchanged(snapshot), response, () => undefined);
  });
  const origin = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () =>
      resolve({
        url: `${origin()}${feedPath}`,
        close() {
          server.close();
          server.closeAllConnections();
        },
      }),
    );
  });
}
