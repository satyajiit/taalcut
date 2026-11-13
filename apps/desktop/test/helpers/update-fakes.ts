// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Fakes of electron-updater and Squirrel.Mac for the updater tests (update.test.ts, update-channels.test.ts). */
import { EventEmitter } from 'node:events';
import { ok, type Result } from '@taalcut/core';
import { vi } from 'vitest';
import type { Snapshot } from '../../src/main/update/snapshot';
import { startUpdates, type AppUpdaterPort, type UpdateEvent } from '../../src/main/update/updater';
import type { VerifiedUpdate } from '../../src/main/update/verify-download';

export class FakeUpdater implements AppUpdaterPort {
  readonly events = new EventEmitter();
  autoDownload = false;
  autoInstallOnAppQuit = true;
  allowDowngrade = false;
  logger: AppUpdaterPort['logger'] = null;
  feed: unknown;
  checks = 0;
  private channelName: string | null = null;
  get channel() {
    return this.channelName;
  }
  set channel(value: string | null) {
    this.channelName = value;
  }
  setFeedURL(options: { provider: 'generic'; url: string; channel?: string }) {
    this.feed = options;
  }
  isUpdateSupported(_info: { readonly version: string }): boolean | Promise<boolean> {
    return true;
  }
  checkForUpdates() {
    this.checks += 1;
    return Promise.reject(new Error('offline'));
  }
  on(event: string, listener: (...args: never[]) => void) {
    return this.events.on(event, listener as (...args: unknown[]) => void);
  }
  emit(event: string, ...args: unknown[]) {
    this.events.emit(event, ...args);
  }
}

export class FakeNative extends EventEmitter {
  staged = 0;
  installs = 0;
  feed: unknown;
  setFeedURL(options: { url: string }) {
    this.feed = options;
  }
  checkForUpdates() {
    this.staged += 1;
  }
  quitAndInstall() {
    this.installs += 1;
  }
}

/** electron-updater 6.8.9 sets allowDowngrade when channel is assigned. */
export class DowngradingUpdater extends FakeUpdater {
  override set channel(value: string | null) {
    super.channel = value;
    this.allowDowngrade = true;
  }
  override get channel() {
    return super.channel;
  }
}

export const GOOD = { version: '0.0.2', team: 'WW382UC8JD' };

export function fakeSnapshot(): Snapshot & { disposed: number } {
  return {
    path: '/private/snapshot/update.zip',
    size: 3,
    sha512: 'abc',
    disposed: 0,
    async dispose() {
      this.disposed += 1;
    },
  };
}

export function setup(
  verdict?: () => Promise<Result<VerifiedUpdate>>,
  options: { channel?: string; updater?: FakeUpdater; blocked?: () => readonly string[] } = {},
) {
  const updater = options.updater ?? new FakeUpdater();
  const native = new FakeNative();
  const events: UpdateEvent[] = [];
  const snapshot = fakeSnapshot();
  const verifyDownload = vi.fn((_zip: string) =>
    verdict ? verdict() : Promise.resolve(ok({ identity: GOOD, snapshot })),
  );
  const feed = { url: 'http://127.0.0.1:1/token/feed', close: vi.fn() };
  const serveToSquirrel = vi.fn(async (_snapshot: Snapshot) => feed);
  const timers = {
    setTimeout: vi.fn((callback: () => void) => {
      callback();
      return 'first';
    }),
    setInterval: vi.fn((_callback: () => void) => 'interval'),
    clear: vi.fn(),
  };
  const updates = startUpdates({
    updater,
    native,
    verifyDownload,
    serveToSquirrel,
    feedUrl: 'https://feed.example/',
    ...(options.channel === undefined ? {} : { channel: options.channel }),
    ...(options.blocked ? { blocked: options.blocked } : {}),
    onEvent: (event) => events.push(event),
    schedule: { initialDelayMs: 5, intervalMs: 60_000 },
    timers,
  });
  return { updater, native, events, timers, updates, verifyDownload, serveToSquirrel, feed, snapshot };
}
