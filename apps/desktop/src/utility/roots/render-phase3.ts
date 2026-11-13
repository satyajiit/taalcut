// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Render's Phase 3 ports in the render process (render SPEC P3.15), each optional so its stage falls back as
 * the SPEC says: subject tracks (the media cache's, else the `render.trackSubjects` job through the jobs queue,
 * for reframing), grade LUTs (`vision.bakeGrade` through the queue, render-runner.ts) and the grade's GPU route
 * (the helper's `video.applyCube`), the Style (the library's StyleStore when this process has one), audio's
 * ducking planner (when registered), Content Credentials (the `c2pa-sidecar` component) and the warped
 * generated-music file. render-root.ts spreads `renderPhase3Deps` into the engine's deps.
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  DuckingPlannerToken,
  EventBusToken,
  idSchema,
  ok,
  StyleStoreToken,
  TemplateStoreToken,
  type AssetId,
  type AsyncResult,
  type ComputeFallbackEvent,
  type Container,
  type JobRunner,
  type StyleId,
  type TemplateRef,
} from '@taalcut/core';
import { installedComponentDirSync } from '@taalcut/jobs';
import { createAssetRepository, createSourceRepository } from '@taalcut/library';
import {
  createDerivedCache,
  createJsonLineSidecar,
  type DerivedCache,
  type JsonLineSidecar,
} from '@taalcut/media';
import {
  C2PA_SIDECAR,
  c2paSidecarArgs,
  createC2paSidecarClient,
  createContentCredentials,
  createHelperCubeApplier,
  createStyleSource,
  createSubjectTrackSource,
  createSubjectTrackStore,
  resolveC2paSidecar,
  type C2paSidecar,
  type DerivedJsonFiles,
  type RenderContentCredentials,
  type RenderEngineDeps,
  type SubjectTrackStore,
} from '@taalcut/render';
import { mediaCacheRoot } from '../../shared/media-cache';
import { renderPaths } from '../../shared/render-paths';
import { renderAssetFiles } from '../../shared/render-ports';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { LibraryDatabaseToken } from '../../shared/tokens';
import { HardwareSessionsToken } from './hardware-sessions';
import { libraryProvenance } from './library-phase3';
import { macHelperResolver } from './mac-helper-resolver';
import { faceBoxesWriter } from './render-face-boxes';
import { queuedGradeLuts } from './render-runner';
import { subjectRecipe } from './render-subject-recipe';

/** A sidecar exits after this long without a request. */
const SIDECAR_IDLE_MS = 120_000;

export type RenderPhase3Deps = Pick<
  RenderEngineDeps,
  | 'subjectTracks'
  | 'grades'
  | 'styles'
  | 'cubeApplier'
  | 'ducking'
  | 'credentials'
  | 'generatedMusic'
  | 'appVersion'
  | 'onFaceBoxes'
  | 'provenance'
>;

/** The helper's real path for a folder (it resolves symlinks before checking a root: /var is /private/var). */
const realFolder = (path: string) => realpath(path).catch(() => path);

/** The mac helper with these services, allowed only these folders: one process per set, started on demand. */
export function macHelpers(config: UtilityConfig) {
  const resolver = macHelperResolver(config);
  const started = new Map<string, JsonLineSidecar>();
  let warned = false;
  return async (services: string, roots: readonly string[]): AsyncResult<JsonLineSidecar> => {
    const found = await resolver.resolve();
    if (!found.ok) {
      // Once per process: every reframe or grade without the helper falls back (with its own warning).
      if (!warned) console.warn(`[render] mac helper unavailable: ${found.error.code}`);
      warned = true;
      return found;
    }
    const real = await Promise.all(roots.map(realFolder));
    const key = [services, ...real].join('\n');
    let sidecar = started.get(key);
    if (!sidecar) {
      sidecar = createJsonLineSidecar({
        command: found.value.path,
        args: ['serve', '--services', services, ...real.flatMap((root) => ['--allow-root', root])],
        idleExitMs: SIDECAR_IDLE_MS,
        // Its grade and track services read video through VideoToolbox: never signalled on a stop (IX3-K2).
        holdsVideoSession: true,
      });
      started.set(key, sidecar);
    }
    return ok(sidecar);
  };
}

/** Subject tracks as derived JSON in the media cache (written through media's cache, so its size counts). */
export function subjectTrackStore(container: Container, config: UtilityConfig): SubjectTrackStore {
  let cache: DerivedCache | undefined;
  const root = mediaCacheRoot(config.userData);
  // Built on first use: the cache walks its folder once.
  const cached = () => (cache ??= createDerivedCache({ root, capBytes: Number.MAX_SAFE_INTEGER }));
  const files: DerivedJsonFiles = {
    // A track that isn't on disk (never made, or evicted) is tracked again.
    read: (key) => readFile(cached().absPath(key) ?? join(root, key), 'utf8').catch(() => null),
    write: async (key, body) => {
      const put = await cached().put(key, body);
      return put.ok ? ok(undefined) : put;
    },
  };
  const assets = () => createAssetRepository(container.resolve(LibraryDatabaseToken));
  return createSubjectTrackStore({
    // FRM1-SUB: the helper's tracks on a Mac, the ONNX detector's elsewhere (each its own key).
    recipe: subjectRecipe(),
    files,
    contentHashOf: async (assetId: AssetId) => {
      const asset = assets().get(assetId);
      return asset.ok ? ok(asset.value.contentHash) : asset;
    },
  });
}

/** Where the library may hold originals: every source's root (Content Credentials ingredients come from there). */
export function libraryRoots(container: Container): string[] {
  if (!container.has(LibraryDatabaseToken)) return [];
  return createSourceRepository(container.resolve(LibraryDatabaseToken))
    .list()
    .map((source) => source.rootPath);
}

/**
 * core's ContentCredentials over the installed `c2pa-sidecar` (read and sign); null sidecar until installed. With
 * `stagingDir` (inside one of `roots`) it also reads bytes in memory (`readBytes`, staged there for one read).
 */
export function contentCredentials(
  config: UtilityConfig,
  roots: () => readonly string[],
  onFallback?: (event: ComputeFallbackEvent) => void,
  stagingDir?: string,
): RenderContentCredentials {
  const started = new Map<string, C2paSidecar>();
  const repoDir = join(import.meta.dirname, '..', '..', '..', '..');
  const sidecar = async (): Promise<C2paSidecar | null> => {
    const binary = resolveC2paSidecar({
      ...(!config.packaged && process.env.TAALCUT_C2PA_SIDECAR
        ? { explicit: process.env.TAALCUT_C2PA_SIDECAR }
        : {}),
      componentDir: installedComponentDirSync(join(config.userData, 'components'), C2PA_SIDECAR.componentId),
      development: !config.packaged,
      repoDir,
    });
    if (!binary.ok) return null;
    const real = await Promise.all([...new Set(roots())].map(realFolder));
    const key = [binary.value, ...real].join('\n');
    let client = started.get(key);
    if (!client) {
      client = createC2paSidecarClient(
        createJsonLineSidecar({
          command: binary.value,
          args: c2paSidecarArgs(real),
          idleExitMs: SIDECAR_IDLE_MS,
        }),
      );
      started.set(key, client);
    }
    return client;
  };
  return createContentCredentials({
    sidecar,
    ...(onFallback ? { onFallback } : {}),
    ...(stagingDir ? { stagingDir } : {}),
  });
}

/** The one field of a stored template version this reads (older schema versions may lack it). */
const templateStyleSchema = z.object({ styleId: idSchema<'Style'>().nullable().optional() });

/** The template version's Style, when this process can read templates. */
function templateStyleId(container: Container) {
  if (!container.has(TemplateStoreToken)) return undefined;
  const templates = container.resolve(TemplateStoreToken);
  return async (ref: TemplateRef) => {
    const version = await templates.get(ref.id, ref.version);
    if (!version.ok) return version;
    const parsed = templateStyleSchema.safeParse(version.value.json);
    return ok<StyleId | null>(parsed.success ? (parsed.data.styleId ?? null) : null);
  };
}

/** An asset's original and content hash for tracking; null when offline or not hashed yet (no track key). */
export function trackingAsset(container: Container) {
  const assets = () => createAssetRepository(container.resolve(LibraryDatabaseToken));
  return async (assetId: AssetId) => {
    const original = await renderAssetFiles(container).original(assetId);
    if (!original.ok || !original.value) return original.ok ? ok(null) : original;
    const asset = assets().get(assetId);
    if (!asset.ok) return asset;
    const contentHash = asset.value.contentHash;
    return ok(contentHash ? { path: original.value.path, contentHash } : null);
  };
}

/** The tracker's requests that ran on the CPU, as compute.fallback (ADR 0002). */
export const trackerCpuFallback =
  (onFallback: (event: ComputeFallbackEvent) => void) => (parts: readonly string[]) =>
    onFallback({
      operation: 'render.trackSubjects',
      wanted: ['ane', 'metal'],
      reason: 'accelerator_failed',
      detail: `ran on the CPU: ${parts.join(', ')}`,
    });

/** A hardware video session lease while the helper decodes, when this process has the gate. */
export function hardwareLease(container: Container) {
  if (!container.has(HardwareSessionsToken)) return {};
  const gate = container.resolve(HardwareSessionsToken);
  return { lease: (signal: AbortSignal) => gate.acquire(1, signal) };
}

/**
 * `runner`: the jobs queue through main (render-runner.ts). Without it, missing shots aren't tracked (a centre
 * crop with a warning) and a graded Style renders ungraded with a warning.
 */
export function renderPhase3Deps(
  container: Container,
  config: UtilityConfig,
  runner?: Pick<JobRunner, 'run'>,
): RenderPhase3Deps {
  const events = container.resolve(EventBusToken);
  const onFallback = (event: ComputeFallbackEvent) => events.emit('compute.fallback', event);
  const helpers = macHelpers(config);
  const folders = renderPaths(config.userData);
  const cacheRoot = mediaCacheRoot(config.userData);
  const styleIdOf = templateStyleId(container);
  return {
    subjectTracks: createSubjectTrackSource({
      store: subjectTrackStore(container, config),
      asset: trackingAsset(container),
      ...(runner ? { runner } : {}),
    }),
    ...(runner ? { grades: queuedGradeLuts({ runner, cacheRoot }) } : {}),
    ...(container.has(StyleStoreToken)
      ? {
          styles: createStyleSource({
            styles: container.resolve(StyleStoreToken),
            ...(styleIdOf ? { templateStyleId: styleIdOf } : {}),
          }),
        }
      : {}),
    cubeApplier: async () => {
      // The conform cache holds the segments and the graded copies; the media cache holds the baked cubes.
      const helper = await helpers('grade', [folders.conform, cacheRoot]);
      return helper.ok ? createHelperCubeApplier(helper.value) : null;
    },
    ...(container.has(DuckingPlannerToken) ? { ducking: container.resolve(DuckingPlannerToken) } : {}),
    // P3-V7: generated assets in the export's AI inventory (each asset's stored provenance).
    provenance: libraryProvenance(container),
    credentials: contentCredentials(
      config,
      () => [folders.work, folders.renders, ...libraryRoots(container)],
      onFallback,
    ),
    generatedMusic: async (choice) => {
      const path = join(cacheRoot, choice.warpedKey);
      // Evicted or never warped: preflight stops with render.media_missing. Nothing warps it again; the person
      // generates the music again (music.generate), which writes a new warped file.
      return stat(path).then(
        () => ok(path),
        () => ok(null),
      );
    },
    ...(config.appVersion ? { appVersion: config.appVersion } : {}),
    ...faceBoxesWriter(config),
  };
}
