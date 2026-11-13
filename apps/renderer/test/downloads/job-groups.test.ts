// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX2-DOWNLOADER: the download's components as job rows. One row per job in the jobs' order; the state that matters
// most of its parts (on its way, then failed, waiting, paused, missing; Ready only when every part is here); the
// step a moving row says (a dropped connection first); a failure named by the part's name, a blocked part's by
// the part it waits for.
import type { Component } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { jobGroups, totalsOf } from '../../src/features/downloads/job-groups';

function part(
  id: string,
  job: Component['job'],
  status: Component['status'],
  extra: Partial<Component> = {},
) {
  const component: Component = {
    id,
    name: id.toUpperCase(),
    version: '1',
    licence: 'MIT',
    sizeBytes: 100,
    status,
    usedBy: [],
    needed: true,
    ...(job ? { job } : {}),
    ...extra,
  };
  return component;
}

const failure = (component: string) => ({
  code: 'jobs.download_failed',
  messageKey: 'errors.jobs.download_failed',
  retryable: true,
  params: { component },
});

describe('job rows', () => {
  it('one row per job, in the jobs’ order; a part with no job gets its own row last', () => {
    const groups = jobGroups([
      part('qwen', 'writing', 'installed'),
      part('loose', undefined, 'not-installed'),
      part('whisper', 'speech', 'installed'),
      part('gemma', 'search', 'queued'),
      part('vad', 'speech', 'installed'),
    ]);
    expect(groups.map((group) => [group.key, group.parts.map((each) => each.id)])).toEqual([
      ['speech', ['whisper', 'vad']],
      ['search', ['gemma']],
      ['writing', ['qwen']],
      ['loose', ['loose']],
    ]);
  });

  it('says the state that matters most, and Ready only when every part is here', () => {
    const state = (...statuses: Component['status'][]) =>
      jobGroups(statuses.map((status, i) => part(`p${i}`, 'speech', status)))[0]?.state;
    expect(state('installed', 'installed')).toBe('ready');
    expect(state('installed', 'failed', 'downloading')).toBe('downloading');
    expect(state('queued', 'failed')).toBe('failed');
    expect(state('paused', 'queued')).toBe('queued');
    expect(state('installed', 'paused')).toBe('paused');
    expect(state('installed', 'update-available')).toBe('missing');
  });

  it('adds up bytes here: an installed part whole, the rest what arrived', () => {
    const [speech] = jobGroups([
      part('a', 'speech', 'installed'),
      part('b', 'speech', 'downloading', { bytesDone: 40 }),
      part('c', 'speech', 'paused', { bytesDone: 10 }),
      part('d', 'speech', 'queued'),
    ]);
    expect(speech).toMatchObject({ bytesTotal: 400, bytesDone: 150 });
    expect(
      totalsOf([part('a', 'speech', 'installed'), part('b', 'speech', 'downloading', { bytesDone: 5 })]),
    ).toEqual({
      bytesTotal: 200,
      bytesDone: 105,
      ready: false,
    });
  });

  it('says a dropped connection over the other steps, with the earliest next try', () => {
    const [group] = jobGroups([
      part('a', 'writing', 'downloading', { step: 'verifying' }),
      part('b', 'writing', 'downloading', { step: 'reconnecting', retryAt: 9000 }),
      part('c', 'writing', 'downloading', { step: 'reconnecting', retryAt: 5000 }),
    ]);
    expect(group).toMatchObject({ step: 'reconnecting', retryAt: 5000 });
    expect(jobGroups([part('a', 'writing', 'downloading', { step: 'verifying' })])[0]?.step).toBe(
      'verifying',
    );
  });

  it('names a failure by the part’s name, even when it is another job’s part it waits for', () => {
    const groups = jobGroups([
      part('onnxruntime', 'search', 'failed', { error: failure('onnxruntime') }),
      part('silero', 'speech', 'failed', { error: failure('onnxruntime') }),
      part('whisper', 'speech', 'installed'),
    ]);
    expect(groups.map((group) => [group.key, group.error?.params?.['component'], group.failedIds])).toEqual([
      ['speech', 'ONNXRUNTIME', ['silero']],
      ['search', 'ONNXRUNTIME', ['onnxruntime']],
    ]);
  });

  it('is Ready only when every part a job needs is here, a shared runtime on another row included', () => {
    // ONNX Runtime is Search's row; text in frames and shots run on it too.
    const at = (runtime: Component['status'], extra: Partial<Component> = {}) =>
      jobGroups([
        part('onnxruntime', 'search', runtime, { name: 'ONNX Runtime', ...extra }),
        part('gemma', 'search', 'installed', { needs: ['onnxruntime'] }),
        part('ppocr', 'text', 'installed', { needs: ['onnxruntime'] }),
        part('transnet', 'shots', 'queued', { needs: ['onnxruntime'] }),
        part('qwen', 'writing', 'installed'),
      ]);
    const row = (groups: ReturnType<typeof jobGroups>, key: string) =>
      groups.find((group) => group.key === key);

    const here = at('installed');
    expect(here.map((group) => [group.key, group.state])).toEqual([
      ['search', 'ready'],
      ['text', 'ready'],
      ['shots', 'queued'],
      ['writing', 'ready'],
    ]);
    expect(row(here, 'text')).not.toHaveProperty('needs');

    // Its own part is here, the runtime isn't: not Ready, and the row says what it waits for.
    for (const [runtime, state] of [
      ['downloading', 'queued'],
      ['queued', 'queued'],
      ['paused', 'paused'],
      ['not-installed', 'missing'],
      ['update-available', 'missing'],
    ] as const) {
      expect(row(at(runtime), 'text')).toMatchObject({ state, needs: 'ONNX Runtime' });
      expect(row(at(runtime), 'writing')?.state).toBe('ready');
    }
    // The runtime failed: so did every row that needs it, named by the runtime, and Try again puts it first.
    const down = row(at('failed', { error: failure('onnxruntime') }), 'text');
    expect(down).toMatchObject({ state: 'failed', failedIds: ['onnxruntime'] });
    expect(down?.error?.params?.['component']).toBe('ONNX Runtime');
  });

  it('counts a shared part’s bytes once, on its own row, so the rows add up to the whole', () => {
    const components = [
      part('onnxruntime', 'search', 'installed', { sizeBytes: 9 }),
      part('gemma', 'search', 'downloading', { sizeBytes: 237, bytesDone: 37, needs: ['onnxruntime'] }),
      part('ppocr', 'text', 'queued', { sizeBytes: 12, needs: ['onnxruntime'] }),
      part('transnet', 'shots', 'installed', { sizeBytes: 31, needs: ['onnxruntime'] }),
    ];
    const groups = jobGroups(components);
    expect(groups.map((group) => [group.key, group.bytesTotal, group.bytesDone])).toEqual([
      ['search', 246, 46],
      ['text', 12, 0],
      ['shots', 31, 31],
    ]);
    const whole = totalsOf(components);
    expect(whole).toEqual({ bytesTotal: 289, bytesDone: 77, ready: false });
    expect(groups.reduce((sum, group) => sum + group.bytesTotal, 0)).toBe(whole.bytesTotal);
    expect(groups.reduce((sum, group) => sum + group.bytesDone, 0)).toBe(whole.bytesDone);
  });
});
