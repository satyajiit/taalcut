// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Two guards against a device on the Wi-Fi holding the listener's sockets while the QR screen is open
 * (security review SB-17). Uploads can take hours, so the server has no overall request timeout; instead:
 *
 * - A body that arrives slower than a floor is cut: every window, the socket must have read at least
 *   `minBytes` more while the request's body is still incomplete. A phone uploading over any Wi-Fi sends far
 *   more; a phone whose browser was suspended stops sending, loses the socket and resumes through tus later,
 *   as it would after the 120 s idle limit. Read from `socket.bytesRead`, so the body stream itself (which tus
 *   reads) is never touched.
 * - One address may hold at most `maxPerAddress` sockets, so a single device can't take all 64.
 */
import type { Server } from 'node:http';

export interface SlowBodyLimits {
  readonly windowMs: number;
  readonly minBytes: number;
}

export function dropSlowBodies(server: Server, limits: SlowBodyLimits): void {
  server.on('request', (req, res) => {
    const socket = req.socket;
    let seen = socket.bytesRead;
    const timer = setInterval(() => {
      if (req.complete || socket.destroyed) return stop();
      const now = socket.bytesRead;
      if (now - seen < limits.minBytes) {
        socket.destroy();
        return stop();
      }
      seen = now;
    }, limits.windowMs);
    timer.unref();
    function stop(): void {
      clearInterval(timer);
    }
    req.once('close', stop);
    res.once('close', stop);
  });
}

export function capSocketsPerAddress(server: Server, maxPerAddress: number): void {
  const open = new Map<string, number>();
  server.on('connection', (socket) => {
    const address = socket.remoteAddress ?? '';
    const count = (open.get(address) ?? 0) + 1;
    if (count > maxPerAddress) {
      socket.destroy();
      return;
    }
    open.set(address, count);
    socket.once('close', () => {
      const left = (open.get(address) ?? 1) - 1;
      if (left > 0) open.set(address, left);
      else open.delete(address);
    });
  });
}
