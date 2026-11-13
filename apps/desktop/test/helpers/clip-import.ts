// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Clips imported through media's real stages (UX2, the clip lane's cache tests): a stand-in for library.hash that names
 * each clip's content hash (a hash of its id: one per clip), media's index stages as they are, and a clip made with
 * FFmpeg (Matroska, picture and sound: media.proxy makes a copy, media.previews a waveform).
 */
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  defineIndexStage,
  defineJobKind,
  NO_RETRY,
  ok,
  registerJob,
  stageJob,
  unwrap,
  type AssetId,
  type SourceId,
} from '@taalcut/core';
import { createRepositories, type LibraryDatabase } from '@taalcut/library';
import { createMediaIndexStages, type MediaService } from '@taalcut/media';
import { z } from 'zod';

const hashKind = defineJobKind({
  kind: 'test.hash',
  input: z.object({ assetId: z.string() }),
  output: z.object({}),
  resource: 'cpu',
  retry: NO_RETRY,
});

export const contentHashOf = (assetId: string) => createHash('sha256').update(assetId).digest('hex');

/** library.hash as a stand-in; media's stages as they are. */
export function clipStages(db: LibraryDatabase) {
  const repos = createRepositories(db);
  const hash = defineIndexStage({
    stage: 'library.hash',
    version: 1,
    reads: [],
    milestone: 'searchable',
    needs: [],
    appliesTo: ['video'],
    priority: 'normal',
    job: (view) => stageJob(hashKind, { assetId: view.assetId }),
    result: () => ok({}),
  });
  const job = registerJob(hashKind, async ({ assetId }) => {
    unwrap(repos.assets.setContentHash(assetId as AssetId, contentHashOf(assetId)));
    return ok({});
  });
  return { stages: [hash, ...createMediaIndexStages()], job };
}

/** A watched folder at `dir` for the clips. */
export function clipFolder(db: LibraryDatabase, dir: string): SourceId {
  return unwrap(
    createRepositories(db).sources.add({ kind: 'watched_folder', displayName: 'Trip', rootPath: dir }),
  ).id;
}

/** `seconds` of a test pattern and a tone at `hz` (each clip its own bytes), as an asset in the folder. */
export async function addClip(
  media: Pick<MediaService, 'runFfmpeg'>,
  db: LibraryDatabase,
  folder: { readonly id: SourceId; readonly dir: string },
  name: string,
  options: { readonly seconds: number; readonly hz: number },
): Promise<AssetId> {
  const path = join(folder.dir, name);
  const made = await media.runFfmpeg(
    [
      ...['-y', '-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=30:duration=${options.seconds}`],
      ...['-f', 'lavfi', '-i', `sine=frequency=${options.hz}:sample_rate=48000:duration=${options.seconds}`],
      ...['-shortest', '-c:v', 'mpeg4', '-q:v', '4', '-c:a', 'aac', path],
    ],
    { timeoutMs: 120_000 },
  );
  if (!made.ok) throw new Error(`fixture: ${made.error.code} ${made.error.detail ?? ''}`);
  const repos = createRepositories(db);
  const { size } = await stat(path);
  const clip = unwrap(repos.assets.create({ kind: 'video', sizeBytes: size, originalFilename: name })).id;
  unwrap(
    repos.assetLocations.add({
      assetId: clip,
      sourceId: folder.id,
      storage: 'referenced',
      relativePath: name,
      sizeBytes: size,
      state: 'present',
    }),
  );
  return clip;
}
