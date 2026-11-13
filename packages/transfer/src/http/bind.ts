// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TRANSFER_LIMITS } from '../limits';
import { capSocketsPerAddress, dropSlowBodies, type SlowBodyLimits } from './socket-guards';

const SLOW_BODY: SlowBodyLimits = {
  windowMs: TRANSFER_LIMITS.slowBodyWindowMs,
  minBytes: TRANSFER_LIMITS.slowBodyMinBytes,
};

export function createListener(
  address: string,
  port: number,
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  slowBody: SlowBodyLimits = SLOW_BODY,
): Promise<Server> {
  const server = createServer({ maxHeaderSize: TRANSFER_LIMITS.maxHeaderBytes }, handler);
  // No overall request timeout (an upload can take hours); a body that trickles is cut instead (SB-17).
  server.requestTimeout = 0;
  dropSlowBodies(server, slowBody);
  capSocketsPerAddress(server, TRANSFER_LIMITS.maxSocketsPerAddress);
  server.headersTimeout = TRANSFER_LIMITS.headersTimeoutMs;
  server.timeout = TRANSFER_LIMITS.socketIdleMs;
  server.keepAliveTimeout = TRANSFER_LIMITS.keepAliveMs;
  server.maxConnections = TRANSFER_LIMITS.maxSockets;
  server.on('clientError', (_error, socket) => {
    socket.destroy();
  });
  return new Promise((resolve, reject) => {
    const fail = (error: Error) => {
      server.close();
      reject(error);
    };
    server.once('error', fail);
    server.listen(port, address, () => {
      server.off('error', fail);
      server.on('error', () => undefined);
      resolve(server);
    });
  });
}

export async function closeListener(server: Server | null): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

export async function readSavedPort(stateDir: string): Promise<number | null> {
  try {
    const port = Number((await readFile(join(stateDir, 'port'), 'utf8')).trim());
    if (port >= TRANSFER_LIMITS.portMin && port <= TRANSFER_LIMITS.portMax) return port;
  } catch {
    return null;
  }
  return null;
}

export async function writeSavedPort(stateDir: string, port: number): Promise<void> {
  await writeFile(join(stateDir, 'port'), String(port), { mode: 0o600 });
}
