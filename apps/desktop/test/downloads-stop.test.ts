// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX2-DOWNLOADER: what counts as the download stopping, and what the notification says. A stop is a run ending in
 * `failed` or a refusal appearing while the app runs; never a retry, a part failing while the rest carries on, a
 * pause or a cancel. It names the jobs left without their models in the jobs' order (a part whose dependency failed
 * leaves its job without too), the reason of the first one's failure, and the row a click opens; in every language.
 */
import { describe, expect, it } from 'vitest';
import type { Component, Downloads } from '@taalcut/core';
import { reasonOf, stopNotice, stopOf } from '../src/main/downloads/downloads-stop';
import { mainI18n } from '../src/main/i18n/i18n';

function downloads(state: Downloads['state'], extra: Partial<Downloads> = {}): Downloads {
  return {
    state,
    components: [],
    counts: { installed: 0, downloading: 0, queued: 0, paused: 0, failed: 0, missing: 0 },
    bytesTotal: 0,
    bytesDone: 0,
    bytesPerSecond: 0,
    requiredBytes: 0,
    ...extra,
  };
}

const failure = (code: string, component: string) => ({
  code,
  messageKey: `errors.${code}`,
  retryable: true,
  params: { component },
});

function part(id: string, job: Component['job'], status: Component['status'], code?: string): Component {
  return {
    id,
    name: id === 'loose' ? 'Loose tool' : id,
    version: '1',
    licence: 'MIT',
    sizeBytes: 1,
    status,
    usedBy: [],
    ...(job ? { job } : {}),
    ...(code ? { error: failure(code, id) } : {}),
  };
}

const SPACE = {
  code: 'jobs.downloads_space_low',
  messageKey: 'errors.jobs.downloads_space_low',
  retryable: false,
  params: { requiredBytes: 9, availableBytes: 1 },
};

// ONNX Runtime failed: the parts that need it report its failure too, so their jobs are left without as well.
const ONNX_DOWN = [
  part('whisper-tiny', 'speech', 'installed'),
  part('silero-vad', 'speech', 'failed', 'jobs.download_rejected'),
  part('onnxruntime', 'search', 'failed', 'jobs.download_rejected'),
  part('embeddinggemma-2', 'search', 'failed', 'jobs.download_rejected'),
  part('ppocr-v5-devanagari', 'text', 'failed', 'jobs.download_rejected'),
  part('transnetv2', 'shots', 'failed', 'jobs.download_rejected'),
  part('beat-this', 'beats', 'failed', 'jobs.download_rejected'),
  part('qwen', 'writing', 'installed'),
];

describe('a stop', () => {
  it('is a run ending in failed, or a new refusal; never what a launch finds, a pause, a cancel or a retry', () => {
    const failed = downloads('failed', {
      components: [part('whisper-tiny', 'speech', 'failed', 'jobs.download_failed')],
    });
    expect(stopOf(undefined, failed)).toBeUndefined();
    expect(stopOf(downloads('downloading'), failed)).toMatchObject({
      ran: true,
      reason: 'network',
      job: 'speech',
    });
    expect(stopOf(failed, failed)).toBeUndefined();
    expect(stopOf(downloads('downloading'), downloads('paused'))).toBeUndefined();
    expect(stopOf(downloads('downloading'), downloads('missing'))).toBeUndefined();
    expect(
      stopOf(downloads('downloading'), downloads('downloading', { components: failed.components })),
    ).toBeUndefined();
    // A refusal: new, or a different one; the same one again is not a new stop.
    const refused = downloads('failed', { error: SPACE });
    expect(stopOf(downloads('missing'), refused)).toEqual({ ran: false, jobs: [], reason: 'space' });
    expect(stopOf(failed, refused)).toEqual({ ran: false, jobs: [], reason: 'space' });
    expect(stopOf(refused, refused)).toBeUndefined();
  });

  it('names every job left without its models in the jobs’ order, one with no job by its name, last', () => {
    const stop = stopOf(
      downloads('downloading'),
      downloads('failed', {
        components: [part('loose', undefined, 'failed', 'jobs.install_failed'), ...ONNX_DOWN],
      }),
    );
    expect(stop).toEqual({
      ran: true,
      jobs: [
        { job: 'speech' },
        { job: 'search' },
        { job: 'text' },
        { job: 'shots' },
        { job: 'beats' },
        { name: 'Loose tool' },
      ],
      reason: 'refused',
      job: 'speech',
    });
  });

  it('sorts the component manager’s codes into reasons, and points one it doesn’t know at Settings', () => {
    const reasons = [
      'jobs.disk_space_low',
      'jobs.downloads_space_low',
      'jobs.download_failed',
      'jobs.download_rejected',
      'jobs.checksum_mismatch',
      'jobs.size_mismatch',
      'jobs.extract_failed',
      'jobs.install_failed',
      'jobs.manifest_untrusted',
      'jobs.manifest_invalid',
      'jobs.component_unknown',
      'core.timeout',
    ].map((code) => reasonOf(failure(code, 'x')));
    expect(reasons).toEqual([
      'space',
      'space',
      'network',
      'refused',
      'different',
      'different',
      'install',
      'install',
      'manifest',
      'manifest',
      'manifest',
      'other',
    ]);
    expect(reasonOf(undefined)).toBe('other');
  });
});

describe('the notification’s words', () => {
  const two = {
    ran: true,
    jobs: [{ job: 'speech' }, { job: 'search' }],
    reason: 'network',
    job: 'speech',
  } as const;
  const six = stopOf(downloads('downloading'), downloads('failed', { components: ONNX_DOWN }));

  it('lists the jobs the language’s way, two and “N more” past three', () => {
    const en = mainI18n('en');
    expect(stopNotice(en, two).title).toBe('Couldn’t download the models for Speech and Search');
    expect(six && stopNotice(en, six)).toEqual({
      title: 'Couldn’t download the models for Speech, Search, and 3 more',
      body: 'The download server refused them. Try again later.',
    });
    expect(stopNotice(en, { ran: false, jobs: [], reason: 'space' })).toEqual({
      title: 'Couldn’t download the models this Mac needs',
      body: 'This Mac doesn’t have enough free space for them. Free up some space, then try again.',
    });
  });

  it('says it in Hindi, Spanish and Brazilian Portuguese', () => {
    expect(stopNotice(mainI18n('es'), two)).toEqual({
      title: 'No se pudieron descargar los modelos de Voz y Búsqueda',
      body: 'La conexión se cortaba una y otra vez. Revisa tu conexión a internet y vuelve a intentarlo.',
    });
    expect(stopNotice(mainI18n('pt-BR'), two).title).toBe(
      'Não foi possível baixar os modelos de Fala e Busca',
    );
    expect(stopNotice(mainI18n('hi'), two).title).toBe('बोली और खोज के मॉडल डाउनलोड नहीं हो पाए');
    expect(six && stopNotice(mainI18n('pt-BR'), six).title).toBe(
      'Não foi possível baixar os modelos de Fala, Busca e mais 3',
    );
  });
});
