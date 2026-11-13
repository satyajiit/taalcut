// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Turns off network access in this process for a test suite: TCP connects,
 * DNS lookups and fetch all fail. Replay suites install it to prove they run
 * offline (P1-I3). Unix-socket and pipe connections stay open because test
 * runners use them for IPC. On macOS, `pnpm --filter @taalcut/models
 * test:offline` adds an OS-level sandbox on top.
 */
import dns from 'node:dns';
import net from 'node:net';

export interface NetworkGuard {
  /** Connection attempts that were blocked. */
  readonly blocked: readonly string[];
  restore(): void;
}

export class NetworkDisabledError extends Error {
  constructor(target: string) {
    super(`Network access is disabled in this test (tried ${target}).`);
    this.name = 'NetworkDisabledError';
  }
}

export function disableNetwork(): NetworkGuard {
  const blocked: string[] = [];
  const originalConnect = net.Socket.prototype.connect;
  const originalLookup = dns.lookup;
  const originalPromisesLookup = dns.promises.lookup;
  const originalFetch = globalThis.fetch;

  const refuse = (target: string): never => {
    blocked.push(target);
    throw new NetworkDisabledError(target);
  };

  net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
    // net.connect() hands Socket#connect its arguments already normalised into [options, callback].
    const first = Array.isArray(args[0]) ? (args[0][0] as unknown) : args[0];
    const options =
      typeof first === 'object' && first !== null ? (first as Record<string, unknown>) : undefined;
    const isPipe = typeof first === 'string' || (options !== undefined && typeof options.path === 'string');
    if (isPipe) return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
    const target = options
      ? `${String(options.host ?? 'localhost')}:${String(options.port)}`
      : `${String(args[1] ?? 'localhost')}:${String(first)}`;
    return refuse(`tcp ${target}`);
  } as typeof net.Socket.prototype.connect;
  dns.lookup = ((hostname: string) => refuse(`dns ${hostname}`)) as unknown as typeof dns.lookup;
  dns.promises.lookup = (async (hostname: string) => refuse(`dns ${hostname}`)) as typeof dns.promises.lookup;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return refuse(`fetch ${url}`);
  }) as typeof fetch;

  return {
    blocked,
    restore() {
      net.Socket.prototype.connect = originalConnect;
      dns.lookup = originalLookup;
      dns.promises.lookup = originalPromisesLookup;
      globalThis.fetch = originalFetch;
    },
  };
}
