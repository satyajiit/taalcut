// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX2-DOWNLOADER: the download of everything this Mac needs. A component carries its job, its step and its last
 * failure (without developer detail); the set's state crosses a port as the jobs process serves it; the commands
 * name what a window may ask.
 */
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  COMPONENT_COMMANDS,
  COMPONENT_JOBS,
  createCommandBus,
  createEventBus,
  createMemoryAuditLogStore,
  createUiCommands,
  filesContract,
  SYSTEM_SETTINGS_URLS,
  systemClock,
  type TaalcutEvent,
  componentCommandPayloads,
  componentDownloadsOverRpc,
  componentInstallerContract,
  componentInstallerRouter,
  componentSchema,
  connectRpc,
  defineError,
  downloadsSchema,
  DOWNLOADS_SHOW_ACTION,
  err,
  EVENT_TYPES,
  ok,
  serveRpc,
  taalcutEventSchema,
  uiActionSchema,
  type Component,
  type ComponentsPort,
  type Downloads,
} from '@taalcut/core';
import { channel } from './helpers/ports';

const DiskSpaceLow = defineError<{ component: string; requiredBytes: number; availableBytes: number }>(
  'jobs.disk_space_low',
);

const whisper: Omit<Component, 'status'> = {
  id: 'whisper-tiny',
  name: 'Whisper tiny',
  version: '5359861c',
  licence: 'MIT',
  sizeBytes: 77_691_713,
  usedBy: ['speech'],
  job: 'speech',
  needed: true,
};

function downloads(state: Downloads['state'], extra: Partial<Downloads> = {}): Downloads {
  return {
    state,
    components: [{ ...whisper, status: state === 'ready' ? 'installed' : 'queued' }],
    counts: { installed: 0, downloading: 0, queued: 1, paused: 0, failed: 0, missing: 0 },
    bytesTotal: whisper.sizeBytes,
    bytesDone: 0,
    bytesPerSecond: 0,
    requiredBytes: whisper.sizeBytes,
    ...extra,
  };
}

describe('a component on the wire', () => {
  it('says what it is doing while it downloads, and when it reconnects', () => {
    const reconnecting = componentSchema.parse({
      ...whisper,
      status: 'downloading',
      progress: 0.4,
      bytesDone: 31_000_000,
      bytesPerSecond: 0,
      step: 'reconnecting',
      retryAt: 1_761_300_000_000,
    });
    expect(reconnecting).toMatchObject({ step: 'reconnecting', job: 'speech', needed: true });
    expect(componentSchema.safeParse({ ...whisper, status: 'downloading', step: 'later' }).success).toBe(
      false,
    );
    expect(componentSchema.safeParse({ ...whisper, status: 'resting' }).success).toBe(false);
    expect(componentSchema.safeParse({ ...whisper, status: 'queued', job: 'cooking' }).success).toBe(false);
  });

  it('carries its last failure without the developer detail', () => {
    const error = { ...DiskSpaceLow({ component: 'whisper-tiny', requiredBytes: 9, availableBytes: 1 }) };
    const failed = componentSchema.parse({
      ...whisper,
      status: 'failed',
      error: { ...error, detail: 'statfs(/Users/me): 1 byte free' },
    });
    expect(failed.error).toMatchObject({ code: 'jobs.disk_space_low', params: { requiredBytes: 9 } });
    expect(failed.error).not.toHaveProperty('detail');
  });

  it('says what it can’t run without, so its job waits for a shared runtime another row lists', () => {
    const vad = componentSchema.parse({
      ...whisper,
      id: 'silero-vad',
      status: 'installed',
      needs: ['onnxruntime'],
    });
    expect(vad.needs).toEqual(['onnxruntime']);
    expect(componentSchema.parse({ ...whisper, status: 'installed' })).not.toHaveProperty('needs');
  });
});

describe('the notification that the download stopped', () => {
  it('opens the window on a job’s row, or on the download as a whole', () => {
    for (const job of COMPONENT_JOBS)
      expect(uiActionSchema.parse({ action: DOWNLOADS_SHOW_ACTION, args: { job } })).toEqual({
        action: 'downloads.show',
        args: { job },
      });
    expect(uiActionSchema.safeParse({ action: DOWNLOADS_SHOW_ACTION }).success).toBe(true);
  });
});

describe('the download of everything this Mac needs', () => {
  it('is a state, the components in order, counts, bytes, speed and time left', () => {
    const running = downloadsSchema.parse(
      downloads('downloading', { bytesDone: 1000, bytesPerSecond: 500, etaMs: 2000, freeBytes: 9e10 }),
    );
    expect(running).toMatchObject({ state: 'downloading', etaMs: 2000, freeBytes: 9e10 });
    expect(
      downloadsSchema.safeParse(downloads('downloading', { state: 'stopped' as 'failed' })).success,
    ).toBe(false);
    expect(downloadsSchema.safeParse(downloads('downloading', { bytesPerSecond: -1 })).success).toBe(false);
  });

  it('is an event the jobs process sends', () => {
    expect(EVENT_TYPES).toContain('components.downloads');
    const event = taalcutEventSchema.parse({
      type: 'components.downloads',
      at: 1,
      payload: downloads('ready'),
    });
    expect(event.type).toBe('components.downloads');
  });
});

describe('the commands', () => {
  it('put components first, each once, or none', () => {
    const payload = componentCommandPayloads[COMPONENT_COMMANDS.download];
    expect(payload.parse({})).toEqual({});
    expect(payload.parse({ first: ['whisper-tiny', 'embeddinggemma-2'] })).toEqual({
      first: ['whisper-tiny', 'embeddinggemma-2'],
    });
    expect(payload.safeParse({ first: [] }).success).toBe(false);
    expect(payload.safeParse({ first: ['whisper-tiny', 'whisper-tiny'] }).success).toBe(false);
    for (const name of [
      COMPONENT_COMMANDS.pauseDownloads,
      COMPONENT_COMMANDS.resumeDownloads,
      COMPONENT_COMMANDS.cancelDownloads,
    ])
      expect(componentCommandPayloads[name].parse({})).toEqual({});
  });
});

describe('the download across a port', () => {
  function served(onStart: (first: readonly string[] | undefined) => Downloads | undefined) {
    const asked: string[] = [];
    const port: ComponentsPort = {
      install: async () => err(DiskSpaceLow({ component: 'x', requiredBytes: 1, availableBytes: 0 })),
      get: async () => undefined,
      list: async () => [],
      downloads: async () => downloads('missing'),
      async startDownloads({ first }) {
        asked.push(`start:${first?.join(',') ?? ''}`);
        const started = onStart(first);
        return started
          ? ok(started)
          : err(DiskSpaceLow({ component: 'whisper-tiny', requiredBytes: 9, availableBytes: 1 }));
      },
      pauseDownloads: async () => {
        asked.push('pause');
        return downloads('paused');
      },
      cancelDownloads: async () => {
        asked.push('cancel');
        return downloads('missing');
      },
    };
    const { port1, port2 } = channel();
    serveRpc(componentInstallerRouter(port), port1, { context: {}, exposeDetail: true });
    const client = connectRpc(componentInstallerContract, port2, { peer: 'jobs' }).client;
    return { remote: componentDownloadsOverRpc(() => client), asked };
  }

  it('reads, starts with what goes first, pauses and cancels', async () => {
    const { remote, asked } = served(() => downloads('downloading'));
    expect(await remote.status()).toMatchObject({ ok: true, value: { state: 'missing' } });
    expect(await remote.start({ first: ['whisper-tiny'] })).toMatchObject({
      ok: true,
      value: { state: 'downloading' },
    });
    expect(await remote.start()).toMatchObject({ ok: true });
    expect(await remote.pause()).toMatchObject({ ok: true, value: { state: 'paused' } });
    expect(await remote.cancel()).toMatchObject({ ok: true, value: { state: 'missing' } });
    expect(asked).toEqual(['start:whisper-tiny', 'start:', 'pause', 'cancel']);
  });

  it('returns why it could not start', async () => {
    const { remote } = served(() => undefined);
    const started = await remote.start();
    expect(!started.ok && started.error).toMatchObject({
      code: 'jobs.disk_space_low',
      params: { component: 'whisper-tiny', requiredBytes: 9, availableBytes: 1 },
    });
  });
});

describe('the fix for a disk too full for the download', () => {
  it('is a UI command that opens System Settings › Storage through main', async () => {
    const events = createEventBus({ clock: systemClock });
    const seen: TaalcutEvent[] = [];
    events.onAny((event) => seen.push(event));
    const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: systemClock });
    bus.register(...createUiCommands({ events }).all);
    expect((await bus.dispatch('system.openStorage', {}, { source: 'ui', actor: 'user' })).ok).toBe(true);
    expect(seen.map((event) => event.type === 'ui.action' && event.payload.action)).toEqual([
      'system.openStorage',
    ]);
    const pane = filesContract.openSystemSettings['~orpc'].inputSchema as z.ZodType;
    expect(pane.safeParse({ pane: 'storage' }).success).toBe(true);
    expect(SYSTEM_SETTINGS_URLS.storage).toBe('x-apple.systempreferences:com.apple.settings.Storage');
  });
});
