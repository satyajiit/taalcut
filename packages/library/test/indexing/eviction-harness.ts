// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stages shaped like media's for the eviction tests (UX2): hash → proxy → filmstrip and previews, each storing its
 * file and naming it in its output. `reads`: the filmstrip and previews read the proxy, as media's do.
 */
import { createHash } from 'node:crypto';
import {
  createEventBus,
  defineIndexStage,
  defineJobKind,
  NO_RETRY,
  ok,
  RationalTime,
  stageJob,
  unwrap,
  type AssetId,
  type DerivedFileRef,
  type EventBus,
} from '@taalcut/core';
import { z } from 'zod';
import {
  createIndexingPipeline,
  createRepositories,
  createStageRows,
  type LibraryDatabase,
} from '../../src/index';
import { fakeClock, openTestDb } from '../helpers';
import { createTestQueue, runPipeline, type StubHandler } from './harness';

const kind = (name: string) =>
  defineJobKind({ kind: name, input: z.any(), output: z.any(), resource: 'cpu', retry: NO_RETRY });
const KINDS = {
  hash: kind('test.hash'),
  proxy: kind('test.proxy'),
  filmstrip: kind('test.filmstrip'),
  previews: kind('test.previews'),
};
const RATE = { num: 30, den: 1 };

const file = (hash: string, dir: string, ext: string, mimeType: DerivedFileRef['mimeType']) => ({
  key: `${dir}/${hash.slice(0, 2)}/${hash}.v1.${ext}`,
  bytes: 1000,
  mimeType,
  recipe: 1,
});
export const proxyOf = (hash: string): DerivedFileRef => ({
  kind: 'proxy',
  ...file(hash, 'proxies', 'mp4', 'video/mp4'),
});
export const spriteOf = (hash: string): DerivedFileRef => ({
  kind: 'filmstrip',
  ...file(hash, 'filmstrips', 'jpg', 'image/jpeg'),
});
export const waveOf = (hash: string): DerivedFileRef => ({
  kind: 'waveform',
  ...file(hash, 'waveforms', 'bin', 'application/octet-stream'),
});

/** hash → proxy → filmstrip and previews, shaped like media's, each storing its file and naming it in its output. */
function stages(db: LibraryDatabase, reads: boolean) {
  const repos = createRepositories(db);
  const handlers: Record<string, StubHandler> = {
    [KINDS.hash.kind]: (input) => {
      const { assetId } = input as { assetId: AssetId };
      // One hash per asset (the ids' hex digits alone, used before, could be the same for two ids made together).
      const hash = createHash('sha256').update(assetId).digest('hex');
      unwrap(repos.assets.setContentHash(assetId, hash));
      return ok({ contentHash: hash });
    },
    [KINDS.proxy.kind]: (input) =>
      ok({ file: proxyOf((input as { hash: string }).hash), reusedOriginal: false }),
    [KINDS.filmstrip.kind]: (input) =>
      ok({
        filmstrip: {
          file: spriteOf((input as { hash: string }).hash),
          columns: 2,
          rows: 1,
          tileWidth: 108,
          tileHeight: 192,
          times: [RationalTime.of(0, RATE), RationalTime.of(29, RATE)],
        },
        source: 'keyframes',
      }),
    [KINDS.previews.kind]: (input) => ok({ waveform: waveOf((input as { hash: string }).hash) }),
  };
  const stage = (
    name: string,
    job: (typeof KINDS)[keyof typeof KINDS],
    needs: string[],
    pick: (o: never) => DerivedFileRef | undefined,
  ) =>
    defineIndexStage({
      stage: name,
      version: 1,
      needs,
      appliesTo: ['video'],
      priority: name === 'library.hash' ? 'normal' : 'low',
      ...(reads && name !== 'library.hash' && name !== 'media.proxy' ? { reads: ['media.proxy'] } : {}),
      ...(name === 'media.proxy' ? { stores: () => 'proxy' } : {}),
      job: (view) => stageJob(job, { assetId: view.assetId, hash: view.contentHash }),
      result: (output) => {
        const made = pick(output as never);
        return ok(made ? { derived: [made] } : {});
      },
    });
  return {
    handlers,
    stages: [
      stage('library.hash', KINDS.hash, [], () => undefined),
      stage('media.proxy', KINDS.proxy, ['library.hash'], (o: { file: DerivedFileRef }) => o.file),
      stage(
        'media.filmstrip',
        KINDS.filmstrip,
        ['media.proxy'],
        (o: { filmstrip: { file: DerivedFileRef } }) => o.filmstrip.file,
      ),
      stage(
        'media.previews',
        KINDS.previews,
        ['media.proxy'],
        (o: { waveform: DerivedFileRef }) => o.waveform,
      ),
    ],
  };
}

export async function setup(options: { reads?: boolean } = {}) {
  const clock = fakeClock();
  const db = openTestDb({ file: false, clock: clock.now });
  const events: EventBus = createEventBus({ clock: { now: clock.now } });
  const stub = stages(db, options.reads ?? false);
  const queue = createTestQueue(db, events, stub.handlers);
  const pipeline = createIndexingPipeline({ db, queue, events, stages: stub.stages, log: () => {} });
  await pipeline.start({ poll: false });
  const changed: string[] = [];
  events.on('library.changed', ({ payload }) => changed.push(...payload.ids));
  return {
    clock,
    db,
    events,
    queue,
    pipeline,
    changed,
    rows: createStageRows(db),
    run: () => runPipeline(pipeline, queue),
  };
}

export const hashOf = (db: LibraryDatabase, id: AssetId) =>
  unwrap(createRepositories(db).assets.get(id)).contentHash ?? '';
