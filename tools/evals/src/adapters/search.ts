// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `library.search` over an eval library. The first query indexes the
 * library (search/library-index.ts: vision's stages, TransNetV2 for shots when
 * its model is there, EmbeddingGemma 2 on this Mac, Apple Vision OCR through
 * the mac helper when it is built, decodes as the app's: the same decode switch
 * and default, IX2-F14) into a fresh
 * library database, then every query goes through `createLibrarySearch`, the
 * function the agent process serves: kNN over the active space, FTS5
 * keywords, weighted rank fusion and the filters in SQL. Each `SearchHit`
 * becomes an `EvalShot`: the asset's manifest path and the shot's frames on
 * the asset's grid. Nothing is faked: without the embedding model the
 * adapter refuses to run instead of scoring keyword-only search as search,
 * and a library where any index stage failed answers no query (IX2-F1), so
 * `predict:search` writes nothing and exits 1.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, type LibraryFilters } from '@taalcut/core';
import { createLibrarySearch } from '@taalcut/library';
import {
  createBinaryResolver,
  createJsonLineSidecar,
  createSidecarResolver,
  type JsonLineSidecar,
  type ResolvedFfmpeg,
} from '@taalcut/media';
import {
  createAppleVisionOcr,
  createOrtRuntime,
  createRoutedOcr,
  DEFAULT_EMBEDDING_PROFILE,
  shotModelDevices,
  TRANSNET_FILE,
  transNetLoader,
  type EmbeddingModelLoader,
  type ImageTokenBudget,
  type OcrEngine,
  type Tier,
} from '@taalcut/vision';
import { z } from 'zod';
import { parseNamed } from '../schema';
import { decodeServiceTook, evalDecodeService, type EvalDecodeOptions } from '../search/eval-decode';
import { evalEmbedder } from '../search/eval-embedder';
import { indexEvalLibrary, type EvalLibraryIndex } from '../search/library-index';
import { type EvalShot, type SearchFilters, type SearchQuery, type SearchSystem } from './types';

const manifestSchema = z.object({
  library: z.string().min(1),
  synthetic: z.boolean().optional(),
  clips: z
    .array(
      z.looseObject({
        asset: z.string().min(1),
        captured: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      }),
    )
    .min(1),
});

export interface LibrarySearchOptions {
  /** The eval library: `manifest.json` and the clips it lists. */
  readonly libraryDir: string;
  /** Where the library database goes. Default: a temp folder, removed by `close`. */
  readonly workDir?: string;
  /** EmbeddingGemma 2's component folder. Default `TAALCUT_EMBEDDINGGEMMA_2_DIR`, else vision's `.cache`. */
  readonly modelDir?: string;
  /**
   * TransNetV2's component folder (`vision.shots`' detector). Default `TAALCUT_TRANSNETV2_DIR`, else vision's
   * `.cache`. Without its model, shots fall back to scdet and the embedding check, as in the app.
   */
  readonly shotModelDir?: string;
  /** Apple Vision OCR through the mac helper. Default: when the helper is built; `true` requires it. */
  readonly ocr?: boolean;
  /** Frames embedded per shot follow the tier. Default 'recommended'. */
  readonly tier?: Tier;
  /** Soft tokens per frame (vision SPEC "Indexing speed: the embedder"). Default: the default profile's (280). */
  readonly imageTokens?: ImageTokenBudget;
  /** An `embeddinggemma-2-coreml` folder: embed with the mac helper's Core ML model instead of ONNX Runtime. */
  readonly coremlDir?: string;
  /** Tests: a stand-in loader instead of transformers.js. */
  readonly loader?: EmbeddingModelLoader;
  /** Tests: the decode switch's environment and the helper (search/eval-decode.ts). Default: what the app has. */
  readonly decode?: EvalDecodeOptions;
  /** Tests: the test run's checked FFmpeg (media's test-support). Default: found and checked here. */
  readonly binaries?: ResolvedFfmpeg;
  readonly log?: (line: string) => void;
}

export interface LibrarySearchSession extends SearchSystem {
  /** Indexes the library once (the first search calls it). */
  index(): Promise<EvalLibraryIndex>;
  close(): Promise<void>;
}

/** On-screen text is read in every v1 language the engines on this Mac serve. */
const OCR_LANGUAGES = ['en', 'hi', 'es', 'pt-BR'] as const;
/** library.search's own cap. */
const MAX_HITS = 100;

function defaultModelDir(): string {
  return (
    process.env.TAALCUT_EMBEDDINGGEMMA_2_DIR ??
    fileURLToPath(new URL('../../../../packages/vision/.cache/embeddinggemma-2/', import.meta.url))
  );
}

/**
 * TransNetV2 from its folder for the indexer's options (none, logged, when the model isn't there), and how to
 * release it once the session closes.
 */
function shotModel(dir: string | undefined, log: (line: string) => void) {
  const modelDir =
    dir ??
    process.env.TAALCUT_TRANSNETV2_DIR ??
    fileURLToPath(new URL('../../../../packages/vision/.cache/transnetv2/', import.meta.url));
  if (!existsSync(join(modelDir, TRANSNET_FILE))) {
    log(`no TransNetV2 in ${modelDir}: shots by scdet and the embedding check`);
    return { options: {}, release: async () => undefined };
  }
  const onnx = createOrtRuntime({
    onFallback: (event) => log(`compute fallback ${event.operation}: ${event.reason}`),
    devices: shotModelDevices(process.platform),
  });
  const boundaryModel = transNetLoader(onnx, async () => modelDir);
  return {
    options: { boundaryModel },
    release: async () => {
      const model = await boundaryModel();
      if (model.ok) await model.value.release();
    },
  };
}

/** The eval's filters in core's terms; frame bounds are checked per hit (they depend on each asset's rate). */
export function libraryFilters(filters: SearchFilters | undefined): LibraryFilters | undefined {
  if (!filters) return undefined;
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
  return {
    ...(filters.orientation ? { orientations: [filters.orientation] } : {}),
    ...(filters.minQuality !== undefined ? { minQuality: filters.minQuality } : {}),
    ...(filters.capturedAfter ? { capturedFrom: day(filters.capturedAfter) } : {}),
    // capturedBefore is exclusive; the library's capturedTo is inclusive.
    ...(filters.capturedBefore ? { capturedTo: day(filters.capturedBefore) - 1 } : {}),
  };
}

/**
 * Why a library with failed stages is not searched: an asset whose frames or shots failed is missing from the
 * kNN, so hit@5 could rise (a distractor gone) or fall (an answer gone) and would not be the gate's number.
 */
function incompleteIndex(failures: readonly string[]): string {
  return `${failures.length} index stage run(s) failed, so no query is scored: ${failures.join('; ')}`;
}

async function loadManifest(libraryDir: string) {
  const path = join(libraryDir, 'manifest.json');
  return parseNamed(manifestSchema, JSON.parse(await readFile(path, 'utf8')), path);
}

async function appleVisionOcr(
  tempDir: string,
  required: boolean,
  log: (line: string) => void,
): Promise<{ ocr: OcrEngine; sidecar: JsonLineSidecar } | undefined> {
  const helper = await createSidecarResolver({
    name: 'taalcut-mac-helper',
    development: true,
    pin: '',
    env: process.env,
  }).resolve();
  if (!helper.ok) {
    if (required)
      throw new Error(`OCR needs the mac helper (${helper.error.code}): run native/mac-helper/build.sh`);
    log(`no on-screen text: the mac helper isn't built (${helper.error.code})`);
    return undefined;
  }
  const sidecar = createJsonLineSidecar({
    command: helper.value.path,
    args: ['serve', '--services', 'ocr,image', '--allow-root', tempDir],
  });
  return { ocr: createRoutedOcr({ vision: createAppleVisionOcr(sidecar, { tempDir }) }), sidecar };
}

/**
 * The run's work folder (a fresh temp one, removed at close, when none is given) and its `tmp` by real path: the
 * helper resolves symlinks (/var → /private/var) before it checks its allowed roots.
 */
async function workFolders(given: string | undefined, cleanup: (() => Promise<void>)[]) {
  const workDir = given ?? (await mkdtemp(join(tmpdir(), 'taalcut-eval-search-')));
  if (given === undefined) cleanup.push(() => rm(workDir, { recursive: true, force: true }));
  if (existsSync(join(workDir, 'library.db'))) throw new Error(`${workDir} already has a library.db`);
  await mkdir(join(workDir, 'tmp'), { recursive: true });
  return { workDir, tempDir: await realpath(join(workDir, 'tmp')) };
}

export function librarySearchSystem(options: LibrarySearchOptions): LibrarySearchSession {
  // onnxruntime-node 1.30 on macOS reports telemetry unless this is set before it loads.
  process.env.ORT_DISABLE_TELEMETRY = '1';
  const log = options.log ?? ((line: string) => console.warn(`[search] ${line}`));
  const libraryDir = resolve(options.libraryDir);
  const imageTokens = options.imageTokens ?? DEFAULT_EMBEDDING_PROFILE.imageTokens;
  const cleanup: (() => Promise<void>)[] = [];
  let indexing: Promise<EvalLibraryIndex> | undefined;
  let searcher: ReturnType<typeof createLibrarySearch> | undefined;
  let libraryName = '';

  async function build(): Promise<EvalLibraryIndex> {
    const manifest = await loadManifest(libraryDir);
    libraryName = manifest.library;
    const modelDir = options.modelDir ?? defaultModelDir();
    if (!options.loader && !existsSync(join(modelDir, 'onnx'))) {
      throw new Error(
        `EmbeddingGemma 2 isn't in ${modelDir}: pass --model-dir or set TAALCUT_EMBEDDINGGEMMA_2_DIR (keyword-only search is not scored)`,
      );
    }
    const binaries = options.binaries
      ? ok(options.binaries)
      : await createBinaryResolver({ development: true }).resolve();
    if (!binaries.ok) throw new Error(`No FFmpeg build (${binaries.error.code}): run tools/ffmpeg/build.sh`);
    const { workDir, tempDir } = await workFolders(options.workDir, cleanup);
    const reader =
      options.ocr === false ? undefined : await appleVisionOcr(tempDir, options.ocr === true, log);
    if (reader) cleanup.unshift(() => reader.sidecar.close());
    const { embedder, checkDevice } = await evalEmbedder({
      modelDir,
      imageTokens,
      ...(options.coremlDir ? { coremlDir: options.coremlDir } : {}),
      tempDir,
      ...(options.loader ? { loader: options.loader } : {}),
      log,
    });
    cleanup.unshift(() => embedder.close());
    const shots = shotModel(options.shotModelDir, log);
    cleanup.unshift(shots.release);
    // Decoded as the app decodes: the same switch, the same default (IX2-F14).
    const decodeService = await evalDecodeService([libraryDir, tempDir], options.decode);
    if (decodeService) cleanup.unshift(() => decodeService.close());
    const started = performance.now();
    const index = await indexEvalLibrary(manifest.clips, {
      libraryDir,
      libraryName: manifest.library,
      workDir,
      media: { binaries: binaries.value },
      embedder,
      ...shots.options,
      ...(reader ? { ocr: reader.ocr } : {}),
      ocrLanguages: OCR_LANGUAGES,
      tier: options.tier ?? 'recommended',
      neutralNames: manifest.synthetic === true,
      tempDir,
      ...(decodeService ? { decodeService } : {}),
      log,
    });
    cleanup.unshift(async () => index.close());
    // The gate is hit@5 over the whole library: a run where any stage failed scores no query (IX2-F1).
    if (index.failures.length > 0) throw new Error(incompleteIndex(index.failures));
    checkDevice();
    log(
      `indexed ${index.pathOf.size} clips (${index.footageSeconds.toFixed(1)} s of footage) in ` +
        `${((performance.now() - started) / 1000).toFixed(1)} s on ${embedder.device() ?? 'no device'}, ` +
        `${imageTokens} tokens per frame, decode service: ${decodeServiceTook(index.decodeTasks)}`,
    );
    searcher = createLibrarySearch({ db: index.db, vectors: index.vectors, embedder });
    return index;
  }

  const index = () => (indexing ??= build());

  return {
    index,
    async search(query: SearchQuery, limit: number): Promise<EvalShot[]> {
      const indexed = await index();
      if (query.library !== libraryName) {
        throw new Error(`${query.queryId} asks library ${query.library}; this one is ${libraryName}`);
      }
      const frames = query.filters?.minFrames !== undefined || query.filters?.maxFrames !== undefined;
      const found = await searcher!.search(
        query.text,
        libraryFilters(query.filters),
        frames ? MAX_HITS : limit,
      );
      if (!found.ok) throw new Error(`${query.queryId}: ${found.error.code} ${found.error.detail ?? ''}`);
      if (found.value.degraded) throw new Error(`${query.queryId}: search fell back to keywords only`);
      const shots: EvalShot[] = [];
      for (const hit of found.value.hits) {
        const asset = indexed.pathOf.get(hit.shot.assetId);
        if (!asset) throw new Error(`${query.queryId}: hit in an asset this run didn't index`);
        // Shot ranges count frames on the asset's grid (media's plan rate): the file's own frames.
        const startFrame = hit.shot.range.start.value;
        const length = Math.max(1, hit.shot.range.duration.value);
        if (query.filters?.minFrames !== undefined && length < query.filters.minFrames) continue;
        if (query.filters?.maxFrames !== undefined && length > query.filters.maxFrames) continue;
        shots.push({ asset, range: { startFrame, endFrame: startFrame + length } });
      }
      return shots.slice(0, Math.max(0, limit));
    },
    async close() {
      for (const step of cleanup.splice(0)) await step();
    },
  };
}
