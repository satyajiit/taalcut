// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdir, rm } from 'node:fs/promises';
import { request, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId, type StagedImport, type TransferPairing, type TransferStreamItem } from '@taalcut/core';
import {
  createTransferService,
  type ImportSink,
  type Reachable,
  type TransferService,
  type TransferSessionId,
} from '../../src/index';
import type { TransferDeps } from '../../src/deps';
import type { LanInterface } from '../../src/network';

const realSetTimeout = globalThis.setTimeout.bind(globalThis);
const realClearTimeout = globalThis.clearTimeout.bind(globalThis);

export interface FixtureClock {
  now(): number;
  set(ms: number): void;
}

export interface FixtureOptions {
  readonly keepReceptionOpen?: boolean;
  readonly retainDestination?: ImportSink['retainDestination'];
  readonly selfTest?: (address: string, port: number) => Promise<Reachable>;
  readonly diskFree?: (dir: string) => Promise<number>;
  readonly probe?: TransferDeps['media']['probe'];
  readonly importStaged?: ImportSink['importStaged'];
  readonly staging?: ImportSink['staging'];
  readonly space?: ImportSink['space'];
  readonly clock?: FixtureClock;
  readonly allowLoopback?: boolean;
  readonly candidates?: () => LanInterface[];
  readonly bind?: TransferDeps['bind'];
  /** When false, the first session item (including a stop) is enough. */
  readonly expectListening?: boolean;
  /** The page's files; a one-line page when left out. */
  readonly phoneAssets?: TransferDeps['phoneAssets'];
}

export interface Fixture {
  readonly service: TransferService;
  readonly root: string;
  readonly staging: string;
  readonly stateDir: string;
  readonly logs: string[];
  readonly events: Array<{ type: string; payload: unknown }>;
  readonly items: TransferStreamItem[];
  readonly clock: FixtureClock;
  address: string;
  port: number;
  sessionId: string;
  pairing: TransferPairing;
  base(): string;
  waitFor(pred: (item: TransferStreamItem) => boolean, ms?: number): Promise<TransferStreamItem>;
  setAddress(address: string): void;
  pokeNetwork(): void;
  replace(): Promise<void>;
  close(): Promise<{ closed: boolean }>;
  /** Stops the listener and leaves the directories in place. */
  release(): Promise<void>;
  dispose(): Promise<void>;
}

export function manualClock(start = 1_700_000_000_000): FixtureClock {
  let now = start;
  return {
    now: () => now,
    set(ms: number) {
      now = ms;
    },
  };
}

/** A real server on 127.0.0.1. Production never sets `allowLoopback`. */
export function startFixture(options: FixtureOptions = {}): Promise<Fixture> {
  return makeRoot().then((root) => startIn(root, options));
}

async function makeRoot(): Promise<string> {
  const root = join(tmpdir(), `taalcut-transfer-${process.pid}-${Math.random().toString(16).slice(2)}`);
  await mkdir(root, { recursive: true });
  return root;
}

export async function startIn(root: string, options: FixtureOptions = {}): Promise<Fixture> {
  const staging = join(root, 'staging');
  const stateDir = join(root, 'state');
  await mkdir(staging, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  const logs: string[] = [];
  const events: Array<{ type: string; payload: unknown }> = [];
  const items: TransferStreamItem[] = [];
  const waiters: Array<() => void> = [];
  const clock = options.clock ?? manualClock();
  let address = '127.0.0.1';
  const watchers: Array<() => void> = [];
  const sink: ImportSink = {
    ...(options.retainDestination ? { retainDestination: options.retainDestination } : {}),
    ...(options.space ? { space: options.space } : {}),
    staging:
      options.staging ??
      (async () => ({ ok: true, value: { dir: staging, freeBytes: 2 ** 40, volumeName: 'Test' } })),
    importStaged:
      options.importStaged ??
      (async (_file: StagedImport) => ({
        ok: true,
        value: { assetId: newId<'Asset'>(), sourceId: newId<'Source'>(), duplicate: 'none' as const },
      })),
  };
  const service = createTransferService({
    ...(options.keepReceptionOpen ? { keepReceptionOpen: true } : {}),
    importSink: sink,
    media: { probe: options.probe ?? (async () => ({ ok: false as const })) },
    events: {
      emit(type, payload) {
        events.push({ type, payload });
      },
    },
    clock,
    stateDir,
    phoneAssets: options.phoneAssets ?? {
      'index.html': {
        bytes: Buffer.from('<!doctype html><title>Taalcut</title>'),
        type: 'text/html; charset=utf-8',
      },
    },
    network: {
      candidates: options.candidates ?? (() => [{ name: 'lo0', address }]),
      watch(onChange) {
        watchers.push(onChange);
        return () => {
          const index = watchers.indexOf(onChange);
          if (index >= 0) watchers.splice(index, 1);
        };
      },
    },
    log: { info: (line) => logs.push(line) },
    selfTest: options.selfTest ?? (async () => 'yes'),
    allowLoopback: options.allowLoopback !== false,
    diskFree: options.diskFree,
    bind: options.bind,
  });

  let sessionId = '';
  let pairing: TransferPairing = { qrText: '', code: '00000000', pin: '000000' };
  let port = 0;
  const controllers: AbortController[] = [];
  const pumps: Array<Promise<void>> = [];

  function notify(): void {
    for (const waiter of [...waiters]) waiter();
  }

  function consume(iter: AsyncIterable<TransferStreamItem>): Promise<void> {
    return (async () => {
      for await (const item of iter) {
        items.push(item);
        if (item.type === 'session' && item.session.state === 'listening' && item.pairing) {
          sessionId = item.session.id;
          pairing = item.pairing;
          if (item.session.url) {
            const url = new URL(item.session.url);
            port = Number(url.port);
            address = url.hostname;
          }
        }
        notify();
      }
    })();
  }

  function open(): void {
    const controller = new AbortController();
    controllers.push(controller);
    pumps.push(consume(service.open({}, controller.signal)));
  }

  function waitFor(pred: (item: TransferStreamItem) => boolean, ms = 20_000): Promise<TransferStreamItem> {
    const found = items.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = realSetTimeout(() => {
        const index = waiters.indexOf(check);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error('timed out waiting for a transfer event'));
      }, ms);
      function check(): void {
        const hit = items.find(pred);
        if (!hit) return;
        realClearTimeout(timer);
        const index = waiters.indexOf(check);
        if (index >= 0) waiters.splice(index, 1);
        resolve(hit);
      }
      waiters.push(check);
    });
  }

  open();
  const wantListening = options.expectListening !== false;
  await waitFor((item) => {
    if (item.type !== 'session') return false;
    return wantListening ? item.session.state === 'listening' && item.pairing !== undefined : true;
  });

  const fixture: Fixture = {
    service,
    root,
    staging,
    stateDir,
    logs,
    events,
    items,
    clock,
    get address() {
      return address;
    },
    set address(value: string) {
      address = value;
    },
    get port() {
      return port;
    },
    set port(value: number) {
      port = value;
    },
    get sessionId() {
      return sessionId;
    },
    set sessionId(value: string) {
      sessionId = value;
    },
    get pairing() {
      return pairing;
    },
    set pairing(value: TransferPairing) {
      pairing = value;
    },
    base: () => `http://${address}:${port}`,
    waitFor,
    setAddress(value: string) {
      address = value;
    },
    pokeNetwork() {
      for (const watcher of [...watchers]) watcher();
    },
    async replace() {
      const previous = sessionId;
      open();
      await waitFor(
        (item) =>
          item.type === 'session' && item.session.state === 'listening' && item.session.id !== previous,
      );
    },
    close: () => service.close(sessionId as TransferSessionId),
    async release() {
      for (const controller of controllers) controller.abort();
      await Promise.allSettled(pumps);
    },
    async dispose() {
      for (const controller of controllers) controller.abort();
      await Promise.allSettled(pumps);
      // The server may still be clearing a refused upload's part file as this runs (ENOTEMPTY under load).
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };
  return fixture;
}

/** The listen socket is closed; a following request is refused. */
export async function untilRefused(host: string, port: number): Promise<void> {
  let last: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await httpCall({ host, port, path: '/api/ping' });
      last = new Error('still accepting');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') return;
      last = error;
    }
    await new Promise((resolve) => realSetTimeout(resolve, 20));
  }
  throw last instanceof Error ? last : new Error('server did not close');
}

export function httpCall(input: {
  readonly host: string;
  readonly port: number;
  readonly method?: string;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string | number>>;
  readonly body?: string | Buffer;
}): Promise<{ status: number; body: string; headers: IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: input.host,
        port: input.port,
        method: input.method ?? 'GET',
        path: input.path,
        headers: { host: `${input.host}:${input.port}`, ...input.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    req.end(input.body);
  });
}
