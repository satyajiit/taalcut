// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { request } from 'node:http';
import { TRANSFER_LIMITS } from '../limits';
import type { Reachable } from '../deps';

/**
 * GET /api/ping on the address we bound. A timeout is `blocked` (a VPN or
 * security tool). An immediate EHOSTUNREACH or EPERM is `local-network-denied`
 * (hypothesis until a clean Mac: phones can still connect) where the OS has a
 * Local Network switch (`localNetworkPrivacy`, macOS); elsewhere it is a
 * firewall's refusal, `blocked`.
 */
export function selfTestPing(
  address: string,
  port: number,
  timeoutMs: number = TRANSFER_LIMITS.selfTestTimeoutMs,
  localNetworkPrivacy = true,
): Promise<Reachable> {
  return new Promise((resolve) => {
    const req = request(
      { host: address, port, path: '/api/ping', method: 'GET', timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve(res.statusCode === 204 ? 'yes' : 'blocked');
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve('blocked');
    });
    req.on('error', (error: NodeJS.ErrnoException) => {
      const refused = error.code === 'EHOSTUNREACH' || error.code === 'EPERM';
      resolve(refused && localNetworkPrivacy ? 'local-network-denied' : 'blocked');
    });
    req.end();
  });
}
