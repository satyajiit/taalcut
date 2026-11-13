// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A TCP port that is free on 127.0.0.1 right now: the OS picks one for a
 * throwaway listener, which closes before the sidecar binds it. Another
 * process can win the port in between; the llama-server driver retries a
 * launch that exits early, on a fresh port.
 */
import { createServer } from 'node:net';

export function findFreeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('No port assigned.'))));
    });
  });
}
