// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId, ok, RationalTime, unwrap, type ComponentInstallerPort } from '@taalcut/core';
import { expect, it } from 'vitest';
import {
  createReferenceFetcher,
  createSourceFetcher,
  parseSourceVideoLink,
  parseSourceVideoMetadata,
  referenceFetchArgs,
  sourceFetchJob,
  SOURCE_FETCH_LIMITS,
} from '../src';
import { createDirSandbox } from './helpers/dir-sandbox';

const url = 'https://www.youtube.com/watch?v=abcDEF12345';
it('accepts one source video and removes share/playlist parameters', () => {
  expect(unwrap(parseSourceVideoLink('https://youtu.be/abcDEF12345?si=secret&list=playlist')).url).toBe(url);
  for (const rejected of [
    'https://youtube.com/playlist?list=x',
    'https://youtube.com/@channel',
    'https://www.instagram.com/reel/x',
    'https://user:pass@youtube.com/watch?v=abcDEF12345',
    'https://youtu.be/x',
  ]) {
    expect(parseSourceVideoLink(rejected).ok).toBe(false);
  }
});

it('keeps short-reference limits intact and preflights source duration and live status', () => {
  const reference = referenceFetchArgs(url);
  expect(reference[reference.indexOf('--max-filesize') + 1]).toBe('80M');
  expect(reference).not.toContain('--match-filters');
  const source = referenceFetchArgs(url, { profile: 'source' });
  expect(source[source.indexOf('--max-filesize') + 1]).toBe('4G');
  expect(source[source.indexOf('--match-filters') + 1]).toBe('duration <= 14400 & !is_live');
  expect(source[source.indexOf('-f') + 1]).toContain('2160');
  expect(sourceFetchJob.timeoutMs).toBeGreaterThan(SOURCE_FETCH_LIMITS.timeoutMs);
  expect(sourceFetchJob.resumable).toBe(true);
});

it('sanitizes source identity without trusting arbitrary channel URLs', () => {
  expect(
    parseSourceVideoMetadata(
      JSON.stringify({
        title: 'Title\n',
        channel: 'Creator',
        channel_url: 'https://www.youtube.com/channel/UCabc?secret=yes',
        uploader_id: '@creator',
      }),
    ),
  ).toEqual({
    title: 'Title',
    channel: 'Creator',
    channelUrl: 'https://www.youtube.com/channel/UCabc',
    uploaderId: '@creator',
  });
  expect(parseSourceVideoMetadata('{"channel_url":"https://evil.example/x"}')).toEqual({});
  expect(parseSourceVideoMetadata('not json')).toBeUndefined();
});

it('imports a long video under source limits while the reference fetcher refuses it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'taalcut-source-intake-'));
  const sandbox = createDirSandbox(root, async (experiment) => {
    const path = join(experiment.dir, 'reference.mp4');
    await writeFile(path, 'fake-media-for-probe');
    return ok({
      exitCode: 101,
      stdout: `${path}\n{"title":"Long lesson","channel":"Creator"}`,
      stderrTail: '',
      durationMs: 1,
      written: [],
    });
  });
  const installed = { id: 'reference-fetcher', version: '1', path: root, notice: join(root, 'NOTICE') };
  const components: ComponentInstallerPort = {
    get: async () => installed,
    install: async () => ok(installed),
  };
  const probe = async () =>
    ok({
      duration: RationalTime.of(3600, { num: 1, den: 1 }),
      rate: { num: 30, den: 1 },
      width: 3840,
      height: 2160,
      hasVideo: true,
      hasAudio: true,
    });
  try {
    const experimentId = newId<'Experiment'>();
    unwrap(await sandbox.open({ id: experimentId, projectId: null, purpose: 'analysis' }));
    const options = { signal: new AbortController().signal };
    const result = unwrap(
      await createSourceFetcher({ sandbox, components, probe }).fetch({ experimentId, url }, options),
    );
    expect(result.metadata).toEqual({ title: 'Long lesson', channel: 'Creator' });
    expect(sandbox.runs[0]?.limits).toMatchObject({
      wallMs: SOURCE_FETCH_LIMITS.timeoutMs,
      diskBytes: SOURCE_FETCH_LIMITS.scratchBytes,
    });
    const reference = await createReferenceFetcher({ sandbox, components, probe }).fetch(
      { experimentId, url },
      options,
    );
    expect(!reference.ok && reference.error.code).toBe('templates.reference_too_long');
    expect(sandbox.runs[1]?.limits).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
