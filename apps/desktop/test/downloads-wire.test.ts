// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX2-DOWNLOADER: the download of everything this Mac needs as the window reads it (`system.downloads`, the
 * `components.downloads` event). Rows are named for their job, a reconnect says when it tries again, a failure
 * says why without developer detail, and the counts and bytes add up. The event goes out at once on a change of
 * state and at most four times a second while bytes arrive.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadsSchema, type Downloads } from '@taalcut/core';
import type { ComponentProgress, ComponentStatus, DownloadSetStatus } from '@taalcut/jobs';
import { createDownloadsFeed } from '../src/utility/roots/downloads-feed';
import { downloadsReport, jobOf, stepOf } from '../src/utility/roots/downloads-wire';
import { usedByOf } from '../src/utility/roots/system-info';

const licence = {
  spdx: 'MIT',
  notice: { url: 'https://example.invalid/NOTICE.txt', size: 1024, sha256: '0'.repeat(64) },
};

function status(id: string, size = 1000): ComponentStatus {
  return {
    id,
    name: id,
    kind: 'model',
    version: '1.0.0',
    tiers: ['recommended'],
    licence,
    state: 'not_installed',
    installing: false,
    downloadBytes: size,
    partialBytes: 0,
  };
}

function progress(extra: Partial<ComponentProgress> = {}): ComponentProgress {
  return {
    componentId: 'x',
    version: '1.0.0',
    phase: 'downloading',
    bytesDone: 400,
    bytesTotal: 1000,
    bytesPerSecond: 50,
    etaSeconds: 12,
    fraction: 0.39,
    ...extra,
  };
}

const failure = {
  code: 'jobs.download_rejected',
  messageKey: 'errors.jobs.download_rejected',
  retryable: false,
  params: { component: 'onnxruntime', status: 404 },
  detail: 'HTTP 404 from https://components.taalcut.app/onnxruntime/1.30.0/onnxruntime.tar.zst',
};

describe('the download as the window reads it', () => {
  it('names rows by job, says each state and step, and adds up the counts', () => {
    const set: DownloadSetStatus = {
      state: 'downloading',
      entries: [
        {
          status: { ...status('local-llm-qwen3-5-4b', 4000) },
          state: 'downloading',
          bytesDone: 400,
          needs: [],
          progress: progress(),
        },
        {
          status: status('whisper-tiny'),
          state: 'downloading',
          bytesDone: 200,
          needs: ['whisper-cpp'],
          progress: progress({
            bytesDone: 200,
            retry: { attempt: 2, at: 1_761_300_000_123.4 },
            bytesPerSecond: 0,
          }),
        },
        {
          status: {
            ...status('silero-vad'),
            state: 'installed',
            installed: {
              id: 'silero-vad',
              version: '1.0.0',
              sha256: 'c'.repeat(64),
              path: '/c/installed/silero-vad/1.0.0-cccccccccccc',
              bytes: 1000,
              installedAt: '2026-10-24T00:00:00.000Z',
              licence,
              notice: '/c/installed/silero-vad/1.0.0-cccccccccccc/TAALCUT-NOTICE.txt',
            },
          },
          state: 'installed',
          bytesDone: 1000,
          needs: ['onnxruntime'],
        },
        { status: status('transnetv2'), state: 'queued', bytesDone: 0, needs: ['onnxruntime'] },
        {
          status: status('embeddinggemma-2'),
          state: 'failed',
          bytesDone: 0,
          needs: ['onnxruntime'],
          error: failure,
        },
        { status: status('onnxruntime'), state: 'failed', bytesDone: 0, needs: [], error: failure },
        { status: status('beat-this'), state: 'paused', bytesDone: 300, needs: ['onnxruntime'] },
        { status: status('sfx-pack'), state: 'missing', bytesDone: 0, needs: [] },
      ],
      bytesTotal: 11_000,
      bytesDone: 2100,
      bytesPerSecond: 250,
      etaSeconds: 36,
      requiredBytes: 20_000,
      availableBytes: 9e9,
      error: { ...failure, code: 'jobs.downloads_space_low' },
      awaitingTerms: [],
    };
    const wire = downloadsSchema.parse(downloadsReport(set, usedByOf));
    expect(wire).toMatchObject({
      state: 'downloading',
      counts: { installed: 1, downloading: 2, queued: 1, paused: 1, failed: 2, missing: 1 },
      bytesTotal: 11_000,
      bytesDone: 2100,
      bytesPerSecond: 250,
      etaMs: 36_000,
      requiredBytes: 20_000,
      freeBytes: 9e9,
    });
    const [qwen, whisper, vad, shots, gemma, , beats] = wire.components;
    expect(qwen).toMatchObject({ job: 'writing', status: 'downloading', step: 'downloading', etaMs: 12_000 });
    expect(whisper).toMatchObject({ job: 'speech', step: 'reconnecting', retryAt: 1_761_300_000_123 });
    expect(vad).toMatchObject({ job: 'speech', status: 'installed', needed: true, needs: ['onnxruntime'] });
    // An installed part's licence notice is on this Mac (Settings links it); the window never gets its path.
    expect(vad?.notice).toBe(true);
    expect(qwen).not.toHaveProperty('notice');
    expect(JSON.stringify(wire)).not.toContain('TAALCUT-NOTICE.txt');
    // What each can't run without goes with it (a job is ready only once those are here); none says nothing.
    expect(whisper?.needs).toEqual(['whisper-cpp']);
    expect(qwen).not.toHaveProperty('needs');
    expect(shots).toMatchObject({ job: 'shots', status: 'queued' });
    expect(gemma).toMatchObject({
      job: 'search',
      status: 'failed',
      error: { params: { component: 'onnxruntime' } },
    });
    expect(beats).toMatchObject({ job: 'beats', status: 'paused', bytesDone: 300 });
    // Developer detail never reaches the window, on a row or on the set.
    expect(JSON.stringify(wire)).not.toContain('components.taalcut.app');
    expect(wire.error).not.toHaveProperty('detail');
  });

  it('says which part each install is in', () => {
    expect(stepOf(progress({ phase: 'checking', bytesTotal: 0 }))).toBe('downloading');
    expect(stepOf(progress({ phase: 'checking' }))).toBe('resuming');
    expect(stepOf(progress({ phase: 'verifying' }))).toBe('verifying');
    expect(stepOf(progress({ phase: 'extracting' }))).toBe('installing');
    expect(stepOf(progress({ phase: 'installing' }))).toBe('installing');
    expect(stepOf(progress({ retry: { attempt: 1, at: 5 } }))).toBe('reconnecting');
  });

  it('names every job the brief lists, and none for tools fetched on demand', () => {
    expect(
      [
        'whisper-medium-q5-0',
        'embeddinggemma-2',
        'ppocr-v5-devanagari',
        'transnetv2-coreml',
        'beat-this',
      ].map(jobOf),
    ).toEqual(['speech', 'search', 'text', 'shots', 'beats']);
    expect(jobOf('local-llm-runtime')).toBe('writing');
    expect(jobOf('reference-fetcher')).toBeUndefined();
  });
});

describe('the components.downloads event', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const report = (bytesDone: number): Downloads => ({
    state: 'downloading',
    components: [],
    counts: { installed: 0, downloading: 1, queued: 0, paused: 0, failed: 0, missing: 0 },
    bytesTotal: 100,
    bytesDone,
    bytesPerSecond: 1,
    requiredBytes: 0,
  });

  it('goes out at once on a change of state, and at most every 250 ms while bytes arrive', async () => {
    vi.useFakeTimers();
    let bytes = 0;
    const sent: number[] = [];
    const feed = createDownloadsFeed({
      read: async () => report(bytes),
      emit: (downloads) => sent.push(downloads.bytesDone),
      now: () => Date.now(),
    });
    bytes = 1;
    feed.changed('state');
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([1]);
    // Within 250 ms of the last: one trailing event, with what is true when it goes.
    bytes = 2;
    feed.changed('progress');
    bytes = 3;
    feed.changed('progress');
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([1]);
    await vi.advanceTimersByTimeAsync(250);
    expect(sent).toEqual([1, 3]);
    bytes = 4;
    feed.changed('state');
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([1, 3, 4]);
    feed.changed('progress');
    feed.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toEqual([1, 3, 4]);
    // Stopped for good: the download halting at quit says nothing.
    feed.changed('state');
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([1, 3, 4]);
  });

  it('logs a read that failed and carries on', async () => {
    const logs: string[] = [];
    let fail = true;
    const sent: number[] = [];
    const feed = createDownloadsFeed({
      read: async () => {
        if (fail) throw new Error('jobs process restarting');
        return report(7);
      },
      emit: (downloads) => sent.push(downloads.bytesDone),
      log: (message) => logs.push(message),
    });
    feed.changed('state');
    await expect.poll(() => logs.length).toBe(1);
    fail = false;
    feed.changed('state');
    await expect.poll(() => sent).toEqual([7]);
    expect(logs[0]).toContain('jobs process restarting');
  });
});
