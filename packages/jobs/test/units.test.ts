// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Small pieces: progress throttling and speed, the disk check, retry timing, HTTP parsing, shared tasks. */
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { checkDiskSpace, nodeStatfs } from '../src/components/disk';
import { contentLength, describeCause, isRetryableStatus, parseContentRange } from '../src/components/http';
import { ProgressReporter, SpeedMeter, type ComponentProgress } from '../src/components/progress';
import { ifRangeValue, validatorsChanged, type PartMeta } from '../src/components/resume-state';
import { backoffDelay, parseRetryAfter, sleep } from '../src/components/retry';
import { SharedTask } from '../src/components/shared-task';
import { diskWithFree } from './helpers/fixtures';

describe('ProgressReporter', () => {
  function reporter(installType: 'file' | 'archive' = 'file', intervalMs = 250) {
    let now = 0;
    const events: ComponentProgress[] = [];
    const r = new ProgressReporter({
      componentId: 'c',
      version: '1',
      installType,
      intervalMs,
      now: () => now,
      onProgress: (p) => events.push(p),
    });
    return { r, events, tick: (ms: number) => (now += ms) };
  }

  it('throttles within a phase but always sends phase changes and phase ends', () => {
    const { r, events, tick } = reporter();
    r.update('checking', 0, 0);
    r.update('downloading', 0, 1000);
    for (let i = 1; i < 10; i++) {
      tick(50);
      r.update('downloading', i * 100, 1000);
    }
    r.update('downloading', 1000, 1000);
    r.update('verifying', 1000, 1000);
    expect(events.map((e) => `${e.phase}:${e.bytesDone}`)).toEqual([
      'checking:0',
      'downloading:0',
      'downloading:500',
      'downloading:1000',
      'verifying:1000',
    ]);
  });

  it('reports speed over a sliding window and an ETA', () => {
    const { r, events, tick } = reporter('file', 0);
    r.update('downloading', 0, 10_000);
    for (let i = 1; i <= 10; i++) {
      tick(1000);
      r.update('downloading', i * 500, 10_000);
    }
    expect(events.at(-1)).toMatchObject({ bytesPerSecond: 500, etaSeconds: 10 });
    r.update('downloading', 10_000, 10_000);
    expect(events.at(-1)!.etaSeconds).toBe(0);
  });

  it('maps phases onto one bar: download, verify, extract, install', () => {
    const { r, events } = reporter('archive', 0);
    r.update('checking', 50, 100);
    r.update('downloading', 100, 100);
    r.update('verifying', 100, 100);
    r.update('extracting', 50, 100);
    r.update('installing', 1, 1);
    expect(events.map((e) => +e.fraction.toFixed(3))).toEqual([0.4, 0.8, 0.82, 0.905, 1]);
    expect(events.filter((e) => e.phase !== 'downloading').every((e) => e.bytesPerSecond === 0)).toBe(true);
  });

  it('has no speed before a second sample', () => {
    const meter = new SpeedMeter(5000, 100, 0);
    expect(meter.bytesPerSecond(0, 0)).toBe(0);
    meter.add(0, 0);
    meter.add(50, 10); // too soon after the first sample: ignored
    expect(meter.bytesPerSecond(0, 10)).toBe(0);
    expect(meter.bytesPerSecond(1000, 1000)).toBe(1000);
  });

  it('says no speed until its samples span 3 s, so a slow first second never becomes "about 8 hr left"', () => {
    const meter = new SpeedMeter();
    meter.add(0, 0);
    // The first second of a resumed download: 141 kB arrived.
    meter.add(1000, 141_000);
    expect(meter.bytesPerSecond(1000, 141_000)).toBe(0);
    meter.add(2000, 8_000_000);
    expect(meter.bytesPerSecond(2999, 8_000_000)).toBe(0);
    meter.add(3000, 16_000_000);
    expect(meter.bytesPerSecond(3000, 16_000_000)).toBeCloseTo(16_000_000 / 3, 0);
  });
});

describe('checkDiskSpace', () => {
  it('passes with room to spare and fails with a plain, fixable error otherwise', async () => {
    const options = { path: '/x', component: 'beat-this', needBytes: 1000, headroomBytes: 4096 };
    expect(await checkDiskSpace({ ...options, statfs: diskWithFree(8192) })).toEqual({
      ok: true,
      value: { availableBytes: 8192, requiredBytes: 5096 },
    });
    const low = await checkDiskSpace({ ...options, statfs: diskWithFree(4096) });
    expect(low).toMatchObject({
      ok: false,
      error: {
        code: 'jobs.disk_space_low',
        params: { component: 'beat-this', requiredBytes: 5096, availableBytes: 4096 },
        fix: { command: 'system.openStorage' },
      },
    });
  });

  it('does not block when the filesystem will not say', async () => {
    const statfs = async () => {
      throw new Error('ENOSYS');
    };
    const result = await checkDiskSpace({
      path: '/x',
      component: 'c',
      needBytes: 1,
      headroomBytes: 1,
      statfs,
    });
    expect(result).toEqual({ ok: true, value: { availableBytes: undefined, requiredBytes: 2 } });
  });

  it('reads the real volume', async () => {
    const result = await checkDiskSpace({
      path: tmpdir(),
      component: 'c',
      needBytes: 0,
      headroomBytes: 0,
      statfs: nodeStatfs,
    });
    expect(result.ok && result.value.availableBytes).toBeGreaterThan(0);
  });
});

describe('retry timing and HTTP helpers', () => {
  it('backs off exponentially with jitter, capped, and respects Retry-After', () => {
    const policy = { maxAttempts: 5, initialDelayMs: 1000, maxDelayMs: 5000 };
    expect([1, 2, 3, 4].map((n) => backoffDelay(policy, n, () => 0.5))).toEqual([1000, 2000, 4000, 5000]);
    expect(backoffDelay(policy, 1, () => 0)).toBe(800);
    expect(backoffDelay(policy, 1, () => 0.5, 3000)).toBe(3000);
    expect(parseRetryAfter('12')).toBe(12_000);
    expect(
      parseRetryAfter('Mon, 12 Oct 2026 10:00:10 GMT', Date.parse('Mon, 12 Oct 2026 10:00:00 GMT')),
    ).toBe(10_000);
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it('sleeps, and stops sleeping on abort', async () => {
    await sleep(1);
    await expect(sleep(10_000, AbortSignal.abort(new Error('stop')))).rejects.toThrow('stop');
    const controller = new AbortController();
    const pending = sleep(10_000, controller.signal);
    controller.abort(new Error('later'));
    await expect(pending).rejects.toThrow('later');
  });

  it('parses Content-Range and Content-Length, and classifies statuses', () => {
    expect(parseContentRange('bytes 100-199/1000')).toEqual({ start: 100, end: 199, total: 1000 });
    expect(parseContentRange('bytes 0-9/*')).toEqual({ start: 0, end: 9, total: undefined });
    expect(parseContentRange('items 1-2/3')).toBeUndefined();
    expect(parseContentRange(null)).toBeUndefined();
    expect(contentLength(new Headers({ 'content-length': '42' }))).toBe(42);
    expect(contentLength(new Headers())).toBeUndefined();
    expect([500, 503, 408, 425, 429].every(isRetryableStatus)).toBe(true);
    expect([400, 403, 404, 410].some(isRetryableStatus)).toBe(false);
    expect(describeCause('plain')).toBe('plain');
  });

  it('builds If-Range from strong validators only, and compares ETags weakly', () => {
    const meta: PartMeta = { v: 1, url: 'u', size: 1, sha256: 's', etag: 'W/"a"', lastModified: 'date' };
    expect(ifRangeValue(meta)).toBe('date');
    expect(ifRangeValue({ ...meta, etag: '"a"' })).toBe('"a"');
    expect(validatorsChanged(meta, '"a"', undefined)).toBe(false);
    expect(validatorsChanged(meta, '"b"', 'date')).toBe(true);
    expect(validatorsChanged({ ...meta, etag: undefined }, undefined, 'other')).toBe(true);
    expect(validatorsChanged({ ...meta, etag: undefined, lastModified: undefined }, '"x"', 'y')).toBe(false);
  });
});

describe('SharedTask', () => {
  function deferredTask() {
    let finish!: (value: string) => void;
    let seenSignal!: AbortSignal;
    let emit!: (p: number) => void;
    const task = new SharedTask<string, number>(
      (signal, e) =>
        new Promise((resolve) => {
          seenSignal = signal;
          emit = e;
          finish = (value) => resolve({ ok: true, value });
          signal.addEventListener('abort', () =>
            resolve({ ok: false, error: { code: 'core.cancelled', messageKey: 'x', retryable: false } }),
          );
        }),
    );
    return { task, finish: (v: string) => finish(v), emit: (p: number) => emit(p), signal: () => seenSignal };
  }

  it('fans out progress and the result; a late joiner gets the latest progress', async () => {
    const t = deferredTask();
    const a = vi.fn();
    const first = t.task.join({ onProgress: a });
    await Promise.resolve();
    t.emit(1);
    const b = vi.fn();
    const second = t.task.join({ onProgress: b });
    t.emit(2);
    t.finish('done');
    expect(await first).toEqual({ ok: true, value: 'done' });
    expect(await second).toEqual({ ok: true, value: 'done' });
    expect(a.mock.calls.map((c) => c[0])).toEqual([1, 2]);
    expect(b.mock.calls.map((c) => c[0])).toEqual([1, 2]);
    expect(await t.task.join()).toEqual({ ok: true, value: 'done' });
  });

  it('detaches one cancelling caller; aborts the work when the last one leaves', async () => {
    const t = deferredTask();
    const one = new AbortController();
    const two = new AbortController();
    const first = t.task.join({ signal: one.signal });
    const second = t.task.join({ signal: two.signal });
    await Promise.resolve();
    one.abort();
    expect(await first).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    expect(t.signal().aborted).toBe(false);
    two.abort();
    expect(await second).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    expect(t.signal().aborted).toBe(true);
    expect(await t.task.join({ signal: AbortSignal.abort() })).toMatchObject({ ok: false });
  });

  it('turns a throwing work function into an error result, and cancel() aborts for everyone', async () => {
    const throwing = new SharedTask<string, number>(async () => {
      throw new Error('boom');
    });
    expect(await throwing.join()).toMatchObject({
      ok: false,
      error: { code: 'core.unknown', detail: 'Error' },
    });

    const t = deferredTask();
    const waiting = t.task.join();
    await Promise.resolve();
    t.task.cancel();
    expect(await waiting).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
  });
});
