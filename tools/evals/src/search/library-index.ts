// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Indexes an eval library the way the app's pipeline does, without its job
 * queue: each clip becomes a library asset (BLAKE3 and partial hash, media's
 * facts from the probe and normalisation plan), then vision's own index
 * stages run in order on every asset: `vision.shots` (TransNetV2 when the
 * caller opened it, else scdet and the embedding check), `vision.analyse` (OCR
 * included when an engine is given) and `vision.embed` (EmbeddingGemma 2 into
 * the active space's sqlite-vec index), decoding as the app does (the decode
 * service the same switch gives, IX2-F14). Each stage builds its job from the
 * asset's view, vision's registered handler runs it, the stage maps the
 * output and the library stores it with `applyStageResult`, so the stage rows
 * carry real start and finish times (`pipelineTimings`).
 *
 * Not run: `media.normalise` (proxies, previews), `audio.transcript` and
 * `vision.describe` (no local vision model; the stand-in provider has none).
 * Search therefore reads frames, on-screen text and file names. A synthetic
 * library spells each answer in its file names, so those are stored as
 * neutral `clip-<n>` names.
 */
import { stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import {
  newId,
  RationalTime,
  TimeRange,
  type AssetId,
  type AssetKind,
  type AsyncResult,
  type ComputeFallbackEvent,
  type IndexStageDefinition,
  type JobContext,
  type JobRegistration,
  type VectorIndex,
} from '@taalcut/core';
import {
  applyStageResult,
  buildAssetIndexView,
  createRepositories,
  createStageRows,
  createWasmContentHasher,
  openDatabase,
  openVectorIndex,
  pipelineTimings,
  sqliteVecPath,
  stagePlan,
  type LibraryDatabase,
  type PipelineTimings,
} from '@taalcut/library';
import {
  planNormalisation,
  probeMedia,
  type DecodeService,
  type DecodeServiceTask,
  type MediaContext,
} from '@taalcut/media';
import {
  createVisionIndexStages,
  EMBEDDING_SPACE,
  indexJobRegistrations,
  ocrJobRegistrations,
  type OcrEngine,
  type ShotBoundaryModel,
  type Tier,
  type VisionEmbedder,
} from '@taalcut/vision';

/**
 * The stages this indexer runs, in the pipeline's order. On-screen text is its own stage and has its own vectors
 * (IX-O5): `vision.ocr` reads it, `vision.embedOcr` embeds it; `vision.embed` embeds frames only.
 */
export const EVAL_INDEX_STAGES = [
  'vision.shots',
  'vision.analyse',
  'vision.ocr',
  'vision.embed',
  'vision.embedOcr',
] as const;

export interface EvalClip {
  /** Path inside the library directory, as the labels name it. */
  readonly asset: string;
  /** ISO date (YYYY-MM-DD) of capture, when the manifest gives one. */
  readonly captured?: string;
}

export interface EvalIndexOptions {
  readonly libraryDir: string;
  readonly libraryName: string;
  /** The library database is created here (`library.db`); vision's temp frames go in `tmp`. */
  readonly workDir: string;
  readonly media: MediaContext;
  readonly embedder: VisionEmbedder;
  /** `vision.shots`' model (TransNetV2). Absent: scdet and the embedding check. */
  readonly boundaryModel?: (signal?: AbortSignal) => AsyncResult<ShotBoundaryModel>;
  /** Absent: no on-screen text. */
  readonly ocr?: OcrEngine;
  readonly ocrLanguages: readonly string[];
  readonly tier: Tier;
  /** Store `clip-<n>` as each asset's file name (synthetic libraries name the answer). */
  readonly neutralNames: boolean;
  readonly tempDir: string;
  /**
   * The decode service, as the app's jobs process has it (IX2-F14, search/eval-decode.ts: the same switch and
   * default). Absent: FFmpeg decodes everything.
   */
  readonly decodeService?: DecodeService;
  readonly log?: (line: string) => void;
}

export interface EvalLibraryIndex {
  readonly db: LibraryDatabase;
  readonly vectors: VectorIndex;
  /** The manifest path of each asset. */
  readonly pathOf: ReadonlyMap<string, string>;
  /** Stage times from the rows this run wrote. */
  readonly timings: PipelineTimings;
  /** Seconds of footage indexed (stills count 0). */
  readonly footageSeconds: number;
  /** `<stage> <asset>: <code>` for every stage that failed. */
  readonly failures: readonly string[];
  readonly fallbacks: readonly ComputeFallbackEvent[];
  /** What the decode service took (IX2-F14); none: FFmpeg decoded everything. */
  readonly decodeTasks: readonly DecodeServiceTask[];
  close(): void;
}

function need<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string; detail?: string } },
  what: string,
): T {
  if (!result.ok)
    throw new Error(`${what}: ${result.error.code}${result.error.detail ? ` (${result.error.detail})` : ''}`);
  return result.value;
}

const STILL_RATE = { num: 1, den: 1 };

/** Adds one clip as an asset with media's facts; a still gets its one shot. */
async function addAsset(
  db: LibraryDatabase,
  options: EvalIndexOptions,
  sourceId: Parameters<ReturnType<typeof createRepositories>['assetLocations']['add']>[0]['sourceId'],
  clip: EvalClip,
  n: number,
): Promise<AssetId> {
  const repos = createRepositories(db);
  const path = join(options.libraryDir, clip.asset);
  const probe = need(await probeMedia(path, options.media), `probe ${clip.asset}`);
  const plan = need(planNormalisation(probe), `plan ${clip.asset}`);
  const facts = clip.captured ? { ...plan.facts, captureTime: `${clip.captured}T12:00:00Z` } : plan.facts;
  const hasher = createWasmContentHasher();
  const contentHash = need(await hasher.full(path), `hash ${clip.asset}`);
  const existing = repos.assets.findByContentHash(contentHash);
  if (existing) return existing.id;
  const kind: AssetKind = plan.kind === 'image' ? 'image' : plan.kind === 'audio' ? 'audio' : 'video';
  const sizeBytes = (await stat(path)).size;
  const name = options.neutralNames
    ? `clip-${String(n + 1).padStart(3, '0')}${extname(clip.asset)}`
    : clip.asset.split('/').pop()!;
  const asset = need(
    repos.assets.create({
      kind,
      sizeBytes,
      originalFilename: name,
      contentHash,
      partialHash: need(await hasher.partial(path), `hash ${clip.asset}`),
    }),
    `add ${clip.asset}`,
  );
  need(
    repos.assetLocations.add({
      assetId: asset.id,
      sourceId,
      storage: 'referenced',
      relativePath: clip.asset,
      sizeBytes,
      state: 'present',
    }),
    `locate ${clip.asset}`,
  );
  need(repos.assets.setFacts(asset.id, facts), `facts ${clip.asset}`);
  if (kind === 'image') {
    const one = TimeRange.of(RationalTime.of(0, STILL_RATE), RationalTime.of(1, STILL_RATE));
    need(repos.shots.replaceForAsset(asset.id, asset.generation, [one]), `still shot ${clip.asset}`);
  }
  return asset.id;
}

function jobContext(): JobContext {
  return {
    jobId: newId<'Job'>(),
    projectId: null,
    attempt: 1,
    signal: new AbortController().signal,
    progress: () => {},
  };
}

/** Runs one stage on one asset as the pipeline would: job from the view, handler, result, stored. */
export async function runStage(
  db: LibraryDatabase,
  stage: IndexStageDefinition,
  handlers: ReadonlyMap<string, JobRegistration>,
  assetId: AssetId,
): Promise<string | null> {
  const rows = createStageRows(db);
  const outcome = buildAssetIndexView(db, assetId);
  if (outcome.kind !== 'view') return `${outcome.kind}`;
  const view = outcome.view;
  if (!stage.appliesTo.includes(view.kind)) return null;
  const job = stage.job(view);
  if ('skip' in job) {
    rows.skipped(assetId, stage.stage, job.skip, stage.version, view.generation);
    return null;
  }
  const handler = handlers.get(job.kind.kind);
  if (!handler) return `no handler for ${job.kind.kind}`;
  const input = job.kind.input.safeParse(job.input);
  if (!input.success) return `bad input for ${job.kind.kind}`;
  rows.running(assetId, stage.stage, Date.now());
  const ran = await handler.handler(input.data, jobContext());
  if (!ran.ok) {
    rows.failed(assetId, stage.stage, ran.error, Date.now());
    return `${ran.error.code}${ran.error.detail ? ` (${ran.error.detail})` : ''}`;
  }
  const output = job.kind.output.safeParse(ran.value);
  if (!output.success) return `bad output from ${job.kind.kind}`;
  const result = stage.result(output.data, view);
  if (!result.ok) return result.error.code;
  const stored = applyStageResult(
    db,
    assetId,
    stage.stage,
    view.generation,
    result.value,
    output.data,
    Date.now(),
  );
  return stored.ok ? null : stored.error.code;
}

export async function indexEvalLibrary(
  clips: readonly EvalClip[],
  options: EvalIndexOptions,
): Promise<EvalLibraryIndex> {
  const log = options.log ?? (() => {});
  const db = need(
    openDatabase({ path: join(options.workDir, 'library.db'), extensions: [sqliteVecPath()] }),
    'open the library database',
  );
  try {
    const vectors = need(
      openVectorIndex(db, { name: EMBEDDING_SPACE.indexName, dimensions: EMBEDDING_SPACE.dimensions }),
      'open the vector index',
    );
    const started = Date.now();
    const repos = createRepositories(db);
    const source = need(
      repos.sources.add({
        kind: 'watched_folder',
        displayName: options.libraryName,
        rootPath: options.libraryDir,
        watch: false,
      }),
      'add the library folder',
    );
    const pathOf = new Map<string, string>();
    const assets: AssetId[] = [];
    for (const [n, clip] of clips.entries()) {
      const id = await addAsset(db, options, source.id, clip, n);
      if (!pathOf.has(id)) assets.push(id);
      pathOf.set(id, clip.asset);
    }
    const fallbacks: ComputeFallbackEvent[] = [];
    const deps = {
      media: options.media,
      tier: options.tier,
      embedder: options.embedder,
      ...(options.boundaryModel ? { boundaryModel: options.boundaryModel } : {}),
      index: vectors,
      ...(options.ocr ? { ocr: options.ocr } : {}),
      ...(options.decodeService ? { decodeService: options.decodeService } : {}),
      tempDir: options.tempDir,
      onFallback: (event: ComputeFallbackEvent) => fallbacks.push(event),
    };
    // The index stages' handlers, and vision.ocr's (vision.readShotText).
    const registrations = [...indexJobRegistrations(deps), ...ocrJobRegistrations(deps)];
    const handlers = new Map(registrations.map((r) => [r.kind.kind, r]));
    const all = createVisionIndexStages({
      tier: options.tier,
      ocrLanguages: () => options.ocrLanguages,
      placement: () => 'local',
    });
    const stages = EVAL_INDEX_STAGES.map((name) => all.find((s) => s.stage === name)!);
    const rows = createStageRows(db);
    const failures: string[] = [];
    for (const stage of stages) {
      rows.seed(stagePlan(stage, stages));
      const stageStarted = Date.now();
      for (const assetId of assets) {
        const failed = await runStage(db, stage, handlers, assetId);
        if (failed) failures.push(`${stage.stage} ${pathOf.get(assetId)}: ${failed}`);
      }
      log(`${stage.stage}: ${assets.length} assets in ${((Date.now() - stageStarted) / 1000).toFixed(1)} s`);
    }
    const footage = db.driver
      .prepare(
        `SELECT coalesce(sum(duration_value * 1.0 * duration_rate_den / duration_rate_num), 0) AS s
         FROM assets WHERE duration_value IS NOT NULL AND duration_rate_num > 0`,
      )
      .get();
    return {
      db,
      vectors,
      pathOf,
      timings: pipelineTimings(db, started),
      footageSeconds: Number(footage?.s ?? 0),
      failures,
      fallbacks,
      decodeTasks: options.decodeService?.tasks ?? [],
      close: () => db.close(),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
