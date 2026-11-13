// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A run's loopback ports (AGT2 sbx). macOS has no network namespace, so the shell's loopback is the machine's:
 * workspace.sb opens only these few ports, free when the run starts, for servers the shell's own processes start
 * and connect to (the HyperFrames CLI's file server, which Chrome loads the composition from). Every other port,
 * the host's loopback services among them, stays closed. The shell learns them as TAALCUT_SHELL_PORTS.
 */
import { createServer, type Server } from 'node:net';

/** How many ports a run opens: one per server a command plausibly runs at once. */
export const SHELL_PORTS = 4;
export const SHELL_PORTS_ENV = 'TAALCUT_SHELL_PORTS';

/** `count` distinct loopback ports free now (held together while they are picked, so none repeats). */
export async function freeLoopbackPorts(count = SHELL_PORTS): Promise<number[]> {
  const servers: Server[] = [];
  try {
    for (let i = 0; i < count; i++) {
      const server = createServer();
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
      });
      servers.push(server);
    }
    return servers.map((server) => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('no loopback port');
      return address.port;
    });
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  }
}
