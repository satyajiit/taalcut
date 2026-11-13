// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * An indexed library for the make flow e2e, written through the library's
 * own repositories before the app opens it: the trip folder as a watched
 * source, each clip an asset with its facts, its present location (the real
 * file's size, time and inode, so the app's first scan finds it unchanged
 * and render's preflight finds it), one shot with what
 * vision would store (quality, motion, energy, description), every indexing
 * stage done, and the shot's frame and description vectors in the active
 * space (EmbeddingGemma 2's index, filled with the stand-in model's vectors
 * the jobs process also embeds slot intents with in a test build).
 *
 * The indexing pipeline runs in the app now (lane I1), so the e2e could
 * import the folder instead; the seed keeps the journeys' library the same
 * on every run (the stand-in's descriptions, no model components).
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import {
  RationalTime,
  TELEMETRY_SETTING,
  TimeRange,
  unwrap,
  type MediaFacts,
  type ShotAnalysis,
  type ShotId,
} from '@taalcut/core';
import { LIBRARY_CLIP_SECONDS, LIBRARY_CLIPS, MEDIA_SIZE, REFERENCE_RATE } from '@taalcut/gate-demo';
import { createAudioIndexStages } from '@taalcut/audio';
import {
  createRepositories,
  libraryHashStage,
  openDatabase,
  openVectorIndex,
  sqliteVecPath,
  type VectorItem,
} from '@taalcut/library';
import { createMediaIndexStages } from '@taalcut/media';
import { createVisionIndexStages, EMBEDDING_SPACE } from '@taalcut/vision';
import { libraryPath } from '../src/shared/library-path';
import { standInTextVector } from '../src/shared/standin-embeddings';

/**
 * Every stage the app's pipeline runs (roots/index-stages.ts), done at its current version: a stage's version
 * going up (vision's profile, say) would otherwise index the seeded clips again while a journey runs, and the
 * shots casting reads would change under it.
 */
const STAGES = [
  libraryHashStage,
  ...createMediaIndexStages(),
  ...createVisionIndexStages({ tier: 'recommended', ocrLanguages: () => ['en'], placement: () => 'local' }),
  ...createAudioIndexStages(),
].map(({ stage, version }) => ({ stage, version }));

const DAY_ONE = Date.parse('2026-09-12T08:00:00+05:30');

export interface SeededLibrary {
  readonly sourceId: string;
  readonly shots: readonly { readonly shotId: ShotId; readonly assetId: string; readonly file: string }[];
}

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

export function seedTripLibrary(userData: string, folder: string, files: readonly string[]): SeededLibrary {
  const opened = openDatabase({ path: libraryPath(userData), extensions: [sqliteVecPath()] });
  if (!opened.ok) throw new Error(`library not opened: ${opened.error.code}`);
  const db = opened.value;
  try {
    const vectors = unwrap(
      openVectorIndex(db, { name: EMBEDDING_SPACE.indexName, dimensions: EMBEDDING_SPACE.dimensions }),
    );
    const repos = createRepositories(db);
    const rate = { num: REFERENCE_RATE, den: 1 };
    const frames = LIBRARY_CLIP_SECONDS * REFERENCE_RATE;
    const items: VectorItem[] = [];
    const shots: { shotId: ShotId; assetId: string; file: string }[] = [];
    const stage = db.driver.prepare(
      `INSERT INTO asset_index_stages (asset_id, stage, state, version, updated_at, started_at, finished_at)
       VALUES (?, ?, 'done', ?, ?, ?, ?)`,
    );
    const setFileId = db.driver.prepare('UPDATE asset_locations SET file_id = ? WHERE id = ?');
    const sourceId = db.transaction(() => {
      unwrap(repos.settings.set(TELEMETRY_SETTING.key, { enabled: true, changedAt: DAY_ONE }));
      const source = unwrap(
        repos.sources.add({ kind: 'watched_folder', displayName: basename(folder), rootPath: folder }),
      ).id;
      LIBRARY_CLIPS.forEach((clip, i) => {
        const path = files[i]!;
        const stat = statSync(path);
        const captured = DAY_ONE + i * 25 * 60_000;
        const duration = RationalTime.of(frames, rate);
        const asset = unwrap(
          repos.assets.create({
            kind: 'video',
            sizeBytes: stat.size,
            originalFilename: clip.file,
            contentHash: sha256(path),
            captureTime: captured,
          }),
        );
        const location = unwrap(
          repos.assetLocations.add({
            assetId: asset.id,
            sourceId: source,
            storage: 'referenced',
            relativePath: clip.file,
            absolutePathCached: path,
            sizeBytes: stat.size,
            mtimeMs: Math.round(stat.mtimeMs),
            state: 'present',
          }),
        );
        // What the app's first scan compares (size, mtime, inode): the file is known, not new.
        setFileId.run(stat.ino, location.id);
        const facts: MediaFacts = {
          version: 1,
          width: MEDIA_SIZE.width,
          height: MEDIA_SIZE.height,
          orientation: 'portrait',
          duration,
          frameRate: rate,
          variableFrameRate: false,
          hdr: 'none',
          speed: 'normal',
          speedFactor: 1,
          retimedInFile: false,
          hasAudio: false,
          captureTime: new Date(captured).toISOString().slice(0, 19),
          device: { make: 'Apple', model: 'iPhone 17 Pro' },
        };
        unwrap(repos.assets.setFacts(asset.id, facts));
        const range = TimeRange.of(RationalTime.of(0, rate), duration);
        const [shotId] = unwrap(repos.shots.replaceForAsset(asset.id, 0, [range]));
        const analysis: ShotAnalysis = {
          version: 1,
          range,
          bestFrame: Math.floor(frames / 2),
          orientation: 'portrait',
          quality: {
            version: 1,
            sharpness: clip.quality,
            exposure: 0.8,
            stability: 0.8,
            overall: clip.quality,
            flags: [],
          },
          motion: clip.motion,
          energy: clip.energy,
          onScreenText: [],
          dHash: createHash('sha256').update(clip.file).digest('hex').slice(0, 16),
          description: {
            text: clip.description,
            objects: [...clip.objects],
            place: clip.place,
            shotType: clip.shotType,
            model: { provider: 'e2e', model: 'stand-in', local: true },
          },
        };
        unwrap(repos.shots.putAnalyses([{ shotId: shotId!, analysis }]));
        const now = db.clock();
        for (const { stage: name, version } of STAGES)
          stage.run(asset.id, name, version, now, now - 1000, now);
        const metadata = { assetId: asset.id, sourceId: source, kind: 'frame' };
        const vector = standInTextVector(clip.description);
        items.push(
          { id: `frame:${shotId}:0`, vector, metadata },
          { id: `description:${shotId}`, vector, metadata: { ...metadata, kind: 'description' } },
        );
        shots.push({ shotId: shotId!, assetId: asset.id, file: clip.file });
      });
      return source;
    });
    unwrap(vectors.upsert(items));
    return { sourceId, shots };
  } finally {
    db.close();
  }
}
