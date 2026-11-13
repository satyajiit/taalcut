// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * RenderEngineDeps over fakes for the read side's tests: the in-memory
 * RenderStore, timelines, asset files, kept reels and template versions in
 * maps, a manual clock, events recorded, and the committed fonts. FFmpeg and the shell are the real ones
 * when a suite passes them, placeholders otherwise.
 */
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createManualClock,
  err,
  newId,
  NotFoundError,
  ok,
  type AssetId,
  type ComputeFallbackEvent,
  type ManualClock,
  type RenderRecord,
  type TemplateId,
  type TemplateMedia,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import type { RenderEngineDeps } from '../../src/engine/deps';
import { keptReferenceAudio } from '../../src/music/reference-audio';
import { presetFor } from '../../src/presets/presets.v1';
import { FONTS_DIR, testMeasurer } from '../support/fonts';
import { memoryRenderStore, type MemoryRenderStore } from '../support/render-store';

export interface FakeWorld {
  readonly deps: RenderEngineDeps;
  readonly store: MemoryRenderStore;
  readonly clock: ManualClock;
  readonly timelines: Map<TimelineId, Timeline>;
  /** Originals by asset. */
  readonly originals: Map<AssetId, string>;
  readonly proxies: Map<AssetId, string>;
  readonly emitted: { type: string; payload: unknown }[];
  readonly fallbacks: ComputeFallbackEvent[];
  /** Each template's kept reel, as core's TemplateMediaStore answers it. */
  readonly reels: Map<TemplateId, { readonly media: TemplateMedia; readonly path: string }>;
  /** Template versions as stored (their JSON), by template id: the steps' link and credit. */
  readonly templateVersions: Map<TemplateId, unknown>;
}

/** A kept reel's media row (REF1), with sound unless `hasAudio` says otherwise. */
export function reelMedia(hasAudio = true): TemplateMedia {
  return {
    file: 'reference.mp4',
    bytes: 1024,
    durationMs: 2000,
    sha256: 'a'.repeat(64),
    hasAudio,
    source: 'anonymous',
    keptAt: 1,
  };
}

const NO_FFMPEG: MediaContext = {
  binaries: { ffmpeg: '/nonexistent/ffmpeg', ffprobe: '/nonexistent/ffprobe', source: 'env' },
};

export async function fakeWorld(
  root: string,
  options: { ctx?: MediaContext; shell?: string } = {},
): Promise<FakeWorld> {
  const folders = {
    preview: join(root, 'preview'),
    work: join(root, 'work'),
    conform: join(root, 'conform'),
    renders: join(root, 'renders'),
  };
  for (const dir of Object.values(folders)) await mkdir(dir, { recursive: true });
  const store = memoryRenderStore();
  const clock = createManualClock(1_000_000);
  const timelines = new Map<TimelineId, Timeline>();
  const originals = new Map<AssetId, string>();
  const proxies = new Map<AssetId, string>();
  const emitted: FakeWorld['emitted'] = [];
  const fallbacks: ComputeFallbackEvent[] = [];
  const world = {
    store,
    clock,
    timelines,
    originals,
    proxies,
    emitted,
    fallbacks,
    reels: new Map(),
    templateVersions: new Map(),
  } as FakeWorld;
  const deps: RenderEngineDeps = {
    store,
    timelines: {
      get: async (id) => {
        const timeline = timelines.get(id);
        return timeline ? ok(timeline) : err(NotFoundError({ entity: 'timeline', id }));
      },
      update: async (id) => err(NotFoundError({ entity: 'timeline', id })),
    },
    assets: {
      original: async (assetId) => {
        const path = originals.get(assetId);
        if (!path) return ok(null);
        const info = await stat(path);
        return ok({ path, size: info.size, mtimeMs: info.mtimeMs });
      },
      proxy: async (assetId) => ok(proxies.get(assetId) ?? null),
    },
    referenceAudio: keptReferenceAudio({
      kept: async (templateId) => ok(world.reels.get(templateId) ?? null),
      version: async (ref) =>
        world.templateVersions.has(ref.id)
          ? ok(world.templateVersions.get(ref.id))
          : err(NotFoundError({ entity: 'template', id: ref.id })),
    }),
    media: options.ctx ?? NO_FFMPEG,
    shell: async () => (options.shell ? ok(options.shell) : err(NotFoundError({ entity: 'shell' }))),
    fontsDir: FONTS_DIR,
    measurer: testMeasurer,
    folders,
    clock,
    events: { emit: (type, payload) => void emitted.push({ type, payload }) },
    onFallback: (event) => void fallbacks.push(event),
  };
  return Object.assign(world, { deps });
}

/** A stored render of `timeline` at its revision, ready unless `overrides` say otherwise. */
export function renderRecord(
  timeline: Timeline,
  overrides: Partial<RenderRecord> = {},
): RenderRecord & { readonly requestKey: string } {
  const preset = presetFor('device');
  const request = {
    projectId: timeline.projectId,
    timelineId: timeline.id,
    presetId: preset.id,
    captions: { burnIn: true, sidecars: [] },
    notify: false,
    contentCredentials: { add: false },
    includeBumpers: true,
  };
  return {
    id: newId<'Render'>(),
    projectId: timeline.projectId,
    timelineId: timeline.id,
    timelineRevision: timeline.revision,
    presetId: preset.id,
    status: 'ready',
    jobId: null,
    progress: null,
    name: 'Render test – Device',
    width: preset.width,
    height: preset.height,
    rate: timeline.canvas.rate,
    durationFrames: 60,
    bytes: 1000,
    music: 'platformSound',
    captions: { burnIn: true, sidecars: [] },
    qa: null,
    supersedes: null,
    notify: false,
    error: null,
    credentials: { added: false, state: null },
    batchId: null,
    createdAt: 1_000_000,
    finishedAt: 1_000_500,
    deletedAt: null,
    request,
    filePath: null,
    compositionHash: null,
    qaReport: null,
    requestKey: newId<'Render'>(),
    ...overrides,
  };
}
