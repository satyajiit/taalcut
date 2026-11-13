// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * system.components as the window reads it (UX2-MODELS): a running install carries its progress, bytes and time
 * left, so first run and Settings › Models show a moving bar (they sat at 0% before), and a component whose last
 * install failed says `failed`, with why, instead of quietly going back to "not installed". UX2-DOWNLOADER: a
 * component the download of everything this Mac needs covers is `needed`, named for its job, and says what that
 * download is doing with it.
 */
import { describe, expect, it } from 'vitest';
import type { ComponentStatus, DownloadSetStatus } from '@taalcut/jobs';
import { componentList } from '../src/utility/roots/system-info';

const licence = {
  spdx: 'MIT',
  notice: { url: 'https://example.invalid/NOTICE.txt', size: 1024, sha256: '0'.repeat(64) },
};

function status(id: string, extra: Partial<ComponentStatus> = {}): ComponentStatus {
  return {
    id,
    name: id,
    kind: 'model',
    version: '1.0.0',
    tiers: ['recommended'],
    licence,
    state: 'not_installed',
    installing: false,
    downloadBytes: 1000,
    partialBytes: 0,
    ...extra,
  };
}

const sizeMismatch = {
  code: 'jobs.size_mismatch',
  messageKey: 'errors.jobs.size_mismatch',
  retryable: true,
  params: { component: 'whisper-cpp', expectedBytes: 7977456, actualBytes: 9631456 },
};

describe('componentList', () => {
  it('a running install: downloading, its overall fraction, the bytes so far and the time left', () => {
    const [row] = componentList([
      status('whisper-tiny', {
        installing: true,
        progress: {
          componentId: 'whisper-tiny',
          version: '1.0.0',
          phase: 'downloading',
          bytesDone: 400,
          bytesTotal: 1000,
          bytesPerSecond: 100,
          etaSeconds: 6,
          fraction: 0.388,
        },
      }),
    ]);
    expect(row).toMatchObject({
      id: 'whisper-tiny',
      status: 'downloading',
      step: 'downloading',
      progress: 0.388,
      bytesDone: 400,
      bytesPerSecond: 100,
      etaMs: 6000,
      sizeBytes: 1000,
      usedBy: ['speech'],
      job: 'speech',
    });
    expect(row?.needed).toBeUndefined();
  });

  it('a running install before its first event, and one past its download: no bytes the window would misread', () => {
    const rows = componentList([
      status('a', { installing: true }),
      status('b', {
        installing: true,
        progress: {
          componentId: 'b',
          version: '1.0.0',
          phase: 'extracting',
          bytesDone: 10,
          bytesTotal: 1000,
          bytesPerSecond: 0,
          fraction: 0.82,
        },
      }),
    ]);
    expect(rows[0]).toMatchObject({ status: 'downloading', progress: 0, step: 'downloading' });
    expect(rows[1]).toMatchObject({ status: 'downloading', progress: 0.82, step: 'installing' });
    expect(rows[1]?.bytesPerSecond).toBeUndefined();
    expect(rows[1]?.etaMs).toBeUndefined();
  });

  it('a failed install of one that isn’t here is failed; an installed or running one isn’t', () => {
    const rows = componentList([
      status('failed', { lastError: sizeMismatch }),
      status('kept', { state: 'update_available', lastError: sizeMismatch }),
      status('retrying', { installing: true, lastError: sizeMismatch }),
      status('fine'),
    ]);
    expect(rows.map((row) => [row.id, row.status])).toEqual([
      ['failed', 'failed'],
      ['kept', 'update-available'],
      ['retrying', 'downloading'],
      ['fine', 'not-installed'],
    ]);
    expect(rows[0]?.error).toEqual(sizeMismatch);
  });

  it('a part whose replaced licence notice didn’t arrive is failed with why, its old notice still linked', () => {
    const installed = {
      id: 'deno',
      version: '1.0.0',
      sha256: 'a'.repeat(64),
      path: '/components/installed/deno/1.0.0-aaaaaaaaaaaa',
      bytes: 1000,
      installedAt: '2026-10-25T00:00:00.000Z',
      licence,
      notice: '/components/installed/deno/1.0.0-aaaaaaaaaaaa/TAALCUT-NOTICE.txt',
    };
    const rows = componentList([
      status('deno', { state: 'notice_outdated', installed, lastError: sizeMismatch }),
      status('runtime', { state: 'notice_outdated', installed }),
    ]);
    expect(rows.map((row) => [row.id, row.status, row.notice])).toEqual([
      ['deno', 'failed', true],
      // Nothing failed yet: it is installed, and its notice is on its way.
      ['runtime', 'installed', true],
    ]);
    expect(rows[0]?.error).toEqual(sizeMismatch);
  });

  it('leaves unsupported ones out, in the manifest’s order; what the download covers is needed', () => {
    const set: DownloadSetStatus = {
      state: 'downloading',
      entries: [
        { status: status('model'), state: 'queued', bytesDone: 0, needs: ['runtime'] },
        { status: status('runtime'), state: 'paused', bytesDone: 300, needs: [] },
      ],
      bytesTotal: 2000,
      bytesDone: 300,
      bytesPerSecond: 0,
      requiredBytes: 9000,
      awaitingTerms: [],
    };
    const rows = componentList(
      [status('runtime'), status('elsewhere', { state: 'unsupported' }), status('big'), status('model')],
      set,
    );
    expect(rows.map((row) => [row.id, row.status, row.needed])).toEqual([
      ['runtime', 'paused', true],
      ['big', 'not-installed', undefined],
      ['model', 'queued', true],
    ]);
    expect(rows[0]?.bytesDone).toBe(300);
  });
});
