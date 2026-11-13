// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Every outbound connection attempt in this process, recorded and (outside the allow list) refused, for the
 * Local only journey's "zero outbound connections" (P3-B10, models SPEC P3.6). It wraps the ways a Node or
 * Electron process reaches the network: `net.Socket#connect` (so net.connect and every library under it),
 * `tls.connect`, `http(s).request` and `.get`, `dns.lookup` (callback and promise), `dgram.Socket#send` and
 * `#connect`, the global `fetch` and `WebSocket`. Each attempt keeps its host, port and the stack that made
 * it. A refused attempt fails the way a real network failure does (an 'error' event or a rejected promise),
 * except `new WebSocket`, which throws. Pipes and Unix sockets aren't network and pass untouched.
 *
 * Chromium's own network stack (pages, Electron's `net`) is outside Node: the desktop e2e watches it with
 * the session's webRequest and the OS socket table.
 */
import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import {
  datagramTarget,
  isLoopbackHost,
  normaliseHost,
  requestTarget,
  socketTarget,
  tlsTarget,
  urlTarget,
  type NetworkTarget,
} from './network-targets';

export type NetworkApi =
  | 'net.connect'
  | 'tls.connect'
  | 'http.request'
  | 'https.request'
  | 'dns.lookup'
  | 'dgram.send'
  | 'fetch'
  | 'WebSocket';

export interface NetworkAttempt {
  readonly api: NetworkApi;
  readonly host: string;
  readonly port: number | null;
  readonly allowed: boolean;
  readonly at: number;
  /** Where the attempt came from (the stack without this module's frames). */
  readonly stack: string;
}

export interface NetworkRecorderOptions {
  /**
   * Hosts that may be reached. 'localhost' and '127.0.0.1' allow every loopback address (127.0.0.0/8, ::1).
   * Default: loopback only.
   */
  readonly allow?: readonly string[];
  /** Each attempt as it happens (the desktop e2e appends it to its process's log). */
  readonly onAttempt?: (attempt: NetworkAttempt) => void;
  readonly now?: () => number;
}

export interface NetworkRecorder {
  readonly attempts: readonly NetworkAttempt[];
  /** The attempts outside the allow list. */
  blocked(): NetworkAttempt[];
  /** Puts every wrapped function back. */
  restore(): void;
}

export const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', '::1', 'localhost'];

export class NetworkBlockedError extends Error {
  readonly code = 'ENETBLOCKED';
  constructor(
    readonly api: NetworkApi,
    readonly host: string,
    readonly port: number | null,
  ) {
    super(
      `Network access outside this Mac is off in this test (${api} ${host}${port === null ? '' : `:${port}`}).`,
    );
    this.name = 'NetworkBlockedError';
  }
}

type Patch = { readonly target: object; readonly key: string | symbol; readonly before?: PropertyDescriptor };
type Callable = (...args: never[]) => unknown;
const isCallable = (value: unknown): value is Callable => typeof value === 'function';
type Verdict = { readonly allowed: boolean; readonly error: NetworkBlockedError };

/** What every wrapper shares: one attempt's verdict, and the patch list restore() undoes. */
interface Recording {
  record(api: NetworkApi, target: NetworkTarget): Verdict;
  /** Replaces `target[key]` (a function) with `wrap(original)`; restore() puts the original back. */
  patch(target: object, key: string | symbol, wrap: (original: Callable) => unknown): void;
  /** Set while an http(s) or tls wrapper is deciding: the socket it opens is already recorded. */
  decided: Verdict | undefined;
}

export function recordNetwork(options: NetworkRecorderOptions = {}): NetworkRecorder {
  const now = options.now ?? Date.now;
  const allow = new Set((options.allow ?? LOOPBACK_HOSTS).map(normaliseHost));
  const loopbackAllowed = allow.has('localhost') || allow.has('127.0.0.1') || allow.has('::1');
  const attempts: NetworkAttempt[] = [];
  const patches: Patch[] = [];
  const allowed = (host: string) =>
    allow.has(normaliseHost(host)) || (loopbackAllowed && isLoopbackHost(host));

  const recording: Recording = {
    decided: undefined,
    record(api, target) {
      const attempt: NetworkAttempt = {
        api,
        host: target.host,
        port: target.port,
        allowed: allowed(target.host),
        at: now(),
        stack: callerStack(),
      };
      attempts.push(attempt);
      options.onAttempt?.(attempt);
      return { allowed: attempt.allowed, error: new NetworkBlockedError(api, target.host, target.port) };
    },
    patch(target, key, wrap) {
      const before = Object.getOwnPropertyDescriptor(target, key);
      const original: unknown = Reflect.get(target, key);
      if (!isCallable(original)) return;
      patches.push({ target, key, ...(before ? { before } : {}) });
      Object.defineProperty(target, key, { value: wrap(original), configurable: true, writable: true });
    },
  };
  wrapSockets(recording);
  wrapRequests(recording);
  wrapDns(recording);
  wrapDatagrams(recording);
  wrapWeb(recording);
  // ESM named imports of built-ins ('import { request } from "node:http"') see the wrappers too.
  syncBuiltinESMExports();

  return {
    attempts,
    blocked: () => attempts.filter((attempt) => !attempt.allowed),
    restore() {
      for (const { target, key, before } of patches.splice(0).reverse()) {
        if (before) Object.defineProperty(target, key, before);
        else Reflect.deleteProperty(target, key);
      }
      syncBuiltinESMExports();
    },
  };
}

/** `net.Socket#connect`, under net.connect and every library: an http(s) or tls wrapper may have decided. */
function wrapSockets(recording: Recording): void {
  recording.patch(
    net.Socket.prototype,
    'connect',
    (original) =>
      function connect(this: net.Socket, ...args: unknown[]): unknown {
        const target = socketTarget(args);
        if (!target) return Reflect.apply(original, this, args);
        const verdict = recording.decided ?? recording.record('net.connect', target);
        if (verdict.allowed) return Reflect.apply(original, this, args);
        process.nextTick(() => this.destroy(verdict.error));
        return this;
      },
  );
}

/** `tls.connect` and `http(s).request` / `.get`: recorded once, and the socket they open goes by that verdict. */
function wrapRequests(recording: Recording): void {
  const deciding =
    (api: NetworkApi, target: (args: readonly unknown[]) => NetworkTarget | undefined) =>
    (original: Callable) =>
      function request(this: unknown, ...args: unknown[]): unknown {
        const where = target(args);
        if (!where) return Reflect.apply(original, this, args);
        const outer = recording.decided;
        recording.decided = outer ?? recording.record(api, where);
        try {
          return Reflect.apply(original, this, args);
        } finally {
          recording.decided = outer;
        }
      };
  recording.patch(tls, 'connect', deciding('tls.connect', tlsTarget));
  for (const [module, api, port] of [
    [http, 'http.request', 80],
    [https, 'https.request', 443],
  ] as const) {
    const wrap = deciding(api, (args) => requestTarget(args, port));
    recording.patch(module, 'request', wrap);
    recording.patch(module, 'get', wrap);
  }
}

/** `dns.lookup`, callback and promise. An address literal (a bind to 0.0.0.0, an IP) asks no resolver. */
function wrapDns(recording: Recording): void {
  const verdictOf = (args: readonly unknown[]): Verdict | undefined => {
    const host = typeof args[0] === 'string' ? args[0] : '';
    return net.isIP(host) !== 0 ? undefined : recording.record('dns.lookup', { host, port: null });
  };
  recording.patch(
    dns,
    'lookup',
    (original) =>
      function lookup(this: unknown, ...args: unknown[]): unknown {
        const verdict = verdictOf(args);
        if (!verdict || verdict.allowed) return Reflect.apply(original, this, args);
        const callback = args.findLast((arg) => typeof arg === 'function');
        if (typeof callback === 'function')
          process.nextTick(() => Reflect.apply(callback, undefined, [verdict.error]));
        return undefined;
      },
  );
  recording.patch(
    dns.promises,
    'lookup',
    (original) =>
      function lookup(this: unknown, ...args: unknown[]): unknown {
        const verdict = verdictOf(args);
        return !verdict || verdict.allowed
          ? Reflect.apply(original, this, args)
          : Promise.reject(verdict.error);
      },
  );
}

/** `dgram.Socket#send` (to its address, else the connected peer) and `#connect`. */
function wrapDatagrams(recording: Recording): void {
  const peerOf = (socket: dgram.Socket): NetworkTarget | undefined => {
    try {
      const peer = socket.remoteAddress();
      return { host: peer.address, port: peer.port };
    } catch {
      // Not connected: the send names its own address, or there is nothing to record.
      return undefined;
    }
  };
  recording.patch(
    dgram.Socket.prototype,
    'send',
    (original) =>
      function send(this: dgram.Socket, ...args: unknown[]): unknown {
        const target = datagramTarget(args, () => peerOf(this));
        if (!target) return Reflect.apply(original, this, args);
        const verdict = recording.record('dgram.send', target);
        if (verdict.allowed) return Reflect.apply(original, this, args);
        const callback = args.findLast((arg) => typeof arg === 'function');
        process.nextTick(() =>
          typeof callback === 'function'
            ? Reflect.apply(callback, undefined, [verdict.error])
            : this.emit('error', verdict.error),
        );
        return undefined;
      },
  );
  recording.patch(
    dgram.Socket.prototype,
    'connect',
    (original) =>
      function connect(this: dgram.Socket, ...args: unknown[]): unknown {
        const port = typeof args[0] === 'number' ? args[0] : null;
        const host = typeof args[1] === 'string' ? args[1] : 'localhost';
        const verdict = recording.record('dgram.send', { host, port });
        if (verdict.allowed) return Reflect.apply(original, this, args);
        process.nextTick(() => this.emit('error', verdict.error));
        return undefined;
      },
  );
}

/** The global `fetch` (a refused one rejects) and `WebSocket` (a refused one throws). */
function wrapWeb(recording: Recording): void {
  recording.patch(
    globalThis,
    'fetch',
    (original) =>
      function fetch(this: unknown, ...args: unknown[]): unknown {
        const target = urlTarget(args[0]);
        if (!target) return Reflect.apply(original, this, args);
        const verdict = recording.record('fetch', target);
        return verdict.allowed ? Reflect.apply(original, this, args) : Promise.reject(verdict.error);
      },
  );
  const OriginalWebSocket = globalThis.WebSocket;
  if (typeof OriginalWebSocket !== 'function') return;
  recording.patch(globalThis, 'WebSocket', () => {
    return class RecordedWebSocket extends OriginalWebSocket {
      constructor(...args: ConstructorParameters<typeof WebSocket>) {
        const target = urlTarget(args[0]);
        const verdict = target ? recording.record('WebSocket', target) : undefined;
        if (verdict && !verdict.allowed) throw verdict.error;
        super(...args);
      }
    };
  });
}

/** The caller's stack: this module's own frames dropped, at most 12 frames kept. */
function callerStack(): string {
  const lines = (new Error().stack ?? '').split('\n').slice(1);
  const self =
    lines[0]?.match(/\((.*?):\d+:\d+\)$/)?.[1] ?? lines[0]?.trim().replace(/^at /, '').split(':')[0];
  return lines
    .filter((line) => !self || !line.includes(self))
    .slice(0, 12)
    .map((line) => line.trim())
    .join('\n');
}
