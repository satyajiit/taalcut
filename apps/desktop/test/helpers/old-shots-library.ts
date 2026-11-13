// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A library indexed by the shot detector before TransNetV2 (IX2-C5): main's stage versions and the shots the
 * old detector stored for a synthetic reel (FFmpeg, software encoder), a false cut among them, with stand-in
 * models. The library's real pipeline and vision's real handlers index it; a test then opens it with this
 * build's stages and checks what is left keyed by the shot that is gone.
 */
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createEventBus,
  defineIndexStage,
  defineJobKind,
  NO_RETRY,
  ok,
  RationalTime,
  registerJob,
  stageJob,
  unwrap,
  type AssetId,
  type AssetIndexView,
  type IndexStageDefinition,
  type JobRegistration,
  type MediaFacts,
} from '@taalcut/core';
import {
  buildAssetIndexView,
  createIndexingPipeline,
  createRepositories,
  openDatabase,
  openVectorIndex,
  shotOfItem,
  sqliteVecPath,
  type LibraryDatabase,
} from '@taalcut/library';
import { createTestQueue, runPipeline, type TestQueue } from '@taalcut/library/test-support';
import { createDerivedCache, type FfmpegBinaries, type MediaContext } from '@taalcut/media';
import { buildSyntheticReel } from '@taalcut/media/test-support';
import {
  createEmbedder,
  createVisionJobs,
  createVisionIndexStages,
  EMBEDDING_SPACE,
  shotsFromCuts,
  type VisionJobDeps,
} from '@taalcut/vision';
import { pictureChangeModel } from '@taalcut/vision/test-support';
import { z } from 'zod';
import { colourGridLoader } from './breakdown-fakes';
import { registrationHandlers } from './index-queue';
import { sameDescription, wordOcr } from './vision-index-fakes';

const RATE = { num: 30, den: 1 };
const FRAMES = 210;
/** The reel's real cuts. */
export const CUTS = [60, 105, 165];
/** What the old detector stored: the reel's cuts and a false one at 135. */
export const OLD_CUTS = [60, 105, 135, 165];
/** The stage versions main stored before IX2 (round IX, 8e769390). */
export const MAIN_VERSIONS: Record<string, number> = {
  'vision.shots': 1,
  'vision.analyse': 3,
  'vision.ocr': 5,
  'vision.embedOcr': 1,
  'vision.embed': 2,
  'vision.describe': 1,
};

const hashKind = defineJobKind({
  kind: 'test.hash',
  input: z.object({ assetId: z.string() }),
  output: z.object({}),
  resource: 'cpu',
  retry: NO_RETRY,
});
const normaliseKind = defineJobKind({
  kind: 'test.normalise',
  input: z.object({ assetId: z.string() }),
  output: z.object({ facts: z.custom<MediaFacts>() }),
  resource: 'cpu',
  retry: NO_RETRY,
});

const facts: MediaFacts = {
  version: 1,
  width: 192,
  height: 108,
  orientation: 'landscape',
  duration: RationalTime.of(FRAMES, RATE),
  frameRate: RATE,
  variableFrameRate: false,
  hdr: 'none',
  speed: 'normal',
  speedFactor: 1,
  retimedInFile: false,
  hasAudio: false,
};

/**
 * library.hash and media.normalise as stand-ins (facts without a plan: vision's jobs probe the file). Normalise
 * stores the facts, which the stages that read it would re-run on (round IX3).
 */
function libraryStages(
  db: LibraryDatabase,
  assetFacts: MediaFacts,
): { stages: IndexStageDefinition[]; jobs: JobRegistration[] } {
  const repos = createRepositories(db);
  return {
    stages: [
      defineIndexStage({
        stage: 'library.hash',
        version: 1,
        reads: [],
        milestone: 'searchable',
        needs: [],
        appliesTo: ['video'],
        priority: 'normal',
        job: (view) => stageJob(hashKind, { assetId: view.assetId }),
        result: () => ok({}),
      }),
      defineIndexStage({
        stage: 'media.normalise',
        version: 1,
        reads: [],
        stores: (view) => view.facts,
        milestone: 'searchable',
        needs: ['library.hash'],
        appliesTo: ['video'],
        priority: 'normal',
        job: (view) => stageJob(normaliseKind, { assetId: view.assetId }),
        result: (output) => ok({ facts: (output as { facts: MediaFacts }).facts }),
      }),
    ],
    jobs: [
      registerJob(hashKind, async ({ assetId }) => {
        unwrap(repos.assets.setContentHash(assetId as AssetId, 'ab'.repeat(32)));
        return ok({});
      }),
      registerJob(normaliseKind, async () => ok({ facts: assetFacts })),
    ],
  };
}

/** Vision's index stages (no transcript vectors: the reel has no audio), at `versions` when given. */
export function visionStages(versions?: Record<string, number>): IndexStageDefinition[] {
  return createVisionIndexStages({
    tier: 'recommended',
    ocrLanguages: () => ['en'],
    placement: () => 'local',
  })
    .filter((stage) => stage.stage !== 'vision.embedText')
    .map((stage) => (versions ? { ...stage, version: versions[stage.stage] ?? stage.version } : stage));
}

/** The old detector's job: what round IX's scdet and embedding check stored for this reel. */
export const oldDetector: JobRegistration['handler'] = async () =>
  ok({
    frameRate: RATE,
    frameCount: FRAMES,
    shots: shotsFromCuts(OLD_CUTS, FRAMES, RATE),
    cuts: OLD_CUTS.map((frame) => ({ frame, score: 30, distance: 0.3, method: 'both' })),
  });

/** Vision's handlers over `deps`, shots detected by TransNetV2's stand-in or, `old`, the old detector's answer. */
export function visionJobs(deps: VisionJobDeps, detector: 'model' | 'old' = 'model'): JobRegistration[] {
  const all = createVisionJobs({ ...deps, boundaryModel: async () => ok(pictureChangeModel()) });
  if (detector === 'model') return all;
  return all.map((r) => (r.kind.kind === 'vision.detectShots' ? { ...r, handler: oldDetector } : r));
}

export interface OldShotsLibrary {
  readonly db: LibraryDatabase;
  readonly assetId: AssetId;
  /** Vision's deps with an OCR engine that reads SALE on every frame. */
  readonly deps: VisionJobDeps;
  /**
   * Indexes until nothing is left, failing on any failed job; the job kinds that ran. `modelsInstalled`: a model
   * arrived just before (UX2-MODELS: the pipeline's `modelsInstalled`, which wakes every stage held for its model).
   */
  index(
    stages: IndexStageDefinition[],
    vision: JobRegistration[],
    options?: { readonly modelsInstalled?: boolean },
  ): Promise<string[]>;
  /** The asset's shots as the pipeline sees them. */
  shots(): AssetIndexView['shots'];
  /** The vector ids of one kind for the asset. */
  vectors(kind: string): string[];
  /** The shot ids the search rows name. */
  searchRows(): string[];
  close(): Promise<void>;
}

export interface OldShotsLibraryOptions {
  /** Normalise's facts say the reel has sound (it has none: tests that use this give audio's jobs stand-ins). */
  readonly hasAudio?: boolean;
}

/** A fresh library holding the reel as one asset, not indexed yet. */
export async function openOldShotsLibrary(
  binaries: FfmpegBinaries,
  options: OldShotsLibraryOptions = {},
): Promise<OldShotsLibrary> {
  const dir = await mkdtemp(join(tmpdir(), 'taalcut-old-library-'));
  const media: MediaContext = { binaries };
  const reel = join(dir, 'reel.mp4');
  unwrap(
    await buildSyntheticReel({ width: 192, height: 108, fps: 30, frames: FRAMES, cuts: CUTS }, media, {
      out: reel,
    }),
  );
  const db = unwrap(openDatabase({ path: ':memory:', extensions: [sqliteVecPath()] }));
  const repos = createRepositories(db);
  const source = unwrap(
    repos.sources.add({ kind: 'watched_folder', displayName: 'Reels', rootPath: dir, watch: false }),
  );
  const sizeBytes = (await stat(reel)).size;
  const assetId = unwrap(repos.assets.create({ kind: 'video', sizeBytes, originalFilename: 'reel.mp4' })).id;
  unwrap(
    repos.assetLocations.add({
      assetId,
      sourceId: source.id,
      storage: 'referenced',
      relativePath: 'reel.mp4',
      sizeBytes,
      state: 'present',
    }),
  );
  const index = unwrap(
    openVectorIndex(db, { name: EMBEDDING_SPACE.indexName, dimensions: EMBEDDING_SPACE.dimensions }),
  );
  const cache = createDerivedCache({ root: join(dir, 'derived'), capBytes: 16 * 1024 ** 2 });
  const deps: VisionJobDeps = {
    media,
    tier: 'recommended',
    embedder: createEmbedder({ modelDir: dir, loader: colourGridLoader }),
    index,
    ocr: wordOcr('SALE'),
    background: sameDescription,
    tempDir: dir,
    storeSheet: (key, bytes) => cache.put(key, bytes),
  };
  const library = libraryStages(db, { ...facts, hasAudio: options.hasAudio ?? false });

  const view = () => {
    const outcome = buildAssetIndexView(db, assetId);
    if (outcome.kind !== 'view') throw new Error(`no view: ${outcome.kind}`);
    return outcome.view;
  };

  return {
    db,
    assetId,
    deps,
    async index(stages, vision, options = {}) {
      const events = createEventBus({ clock: { now: () => Date.now() } });
      const failures: string[] = [];
      const queue: TestQueue = createTestQueue(
        db,
        events,
        registrationHandlers([...library.jobs, ...vision], failures),
      );
      const pipeline = createIndexingPipeline({
        db,
        queue,
        events,
        stages: [...library.stages, ...stages],
        // As the jobs process wires it: a skip's `clears` removes the asset's vectors here (round IX3).
        vectors: () => index,
        log: () => {},
      });
      await pipeline.start({ poll: false });
      if (options.modelsInstalled) await pipeline.modelsInstalled();
      try {
        await runPipeline(pipeline, queue);
      } finally {
        pipeline.stop();
      }
      if (failures.length > 0) throw new Error(`jobs failed: ${failures.join('; ')}`);
      return queue.ran.map((line) => line.split(' ')[0] ?? line);
    },
    shots: () => view().shots,
    vectors: (kind) =>
      (
        db.driver
          .prepare(
            `SELECT item_id AS id FROM vec_${EMBEDDING_SPACE.indexName} WHERE asset_id = ? AND kind = ?`,
          )
          .all(assetId, kind) as { id: string }[]
      ).map((row) => row.id),
    searchRows: () =>
      (db.driver.prepare('SELECT shot_id AS id FROM shot_search_rows').all() as { id: string }[]).map(
        (row) => row.id,
      ),
    async close() {
      await deps.embedder?.close();
      db.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** The shot ids a list of frame, OCR and description vector ids name. */
export function shotIdsIn(ids: readonly string[]): Set<string> {
  return new Set(ids.flatMap((id) => shotOfItem(id)?.shotId ?? []));
}
