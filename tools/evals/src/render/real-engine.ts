// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What @taalcut/render's engine needs to export a golden outside the app:
 * an in-memory RenderStore honouring core's port, the timeline and source
 * files from maps, the app's FFmpeg, the pinned headless shell (installed
 * component in the app; HyperFrames' download cache or TAALCUT_HEADLESS_SHELL
 * here), the committed caption fonts and a scratch folder tree. The export
 * itself (conform, compose, capture, encode, mix, finish, QA) is the engine's
 * own `runExport`.
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ConflictError,
  err,
  NotFoundError,
  ok,
  systemClock,
  type AssetId,
  type RenderId,
  type RenderRecord,
  type RenderStore,
  type Result,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import {
  createTextMeasurer,
  renderPackageDir,
  resolveFontDir,
  resolveHeadlessShell,
  type RenderEngineDeps,
  type TextMeasurer,
} from '@taalcut/render';

const ACTIVE = new Set(['queued', 'rendering', 'checking', 'fixing', 'ready', 'needsAttention']);

function memoryRenderStore(): RenderStore & { readonly records: Map<RenderId, RenderRecord> } {
  const records = new Map<RenderId, RenderRecord & { readonly requestKey?: string }>();
  return {
    records,
    async create(record) {
      if (records.has(record.id)) return err(ConflictError({ entity: 'render', id: record.id }));
      const stored = { ...record, progress: null };
      records.set(record.id, stored);
      return ok(stored);
    },
    async get(id) {
      const record = records.get(id);
      return record ? ok(record) : err(NotFoundError({ entity: 'render', id }));
    },
    async list(filter = {}) {
      let list = [...records.values()];
      if (filter.projectId) list = list.filter((record) => record.projectId === filter.projectId);
      if (!filter.includeDeleted) list = list.filter((record) => record.deletedAt === null);
      if (filter.requestKey)
        list = list.filter((record) => record.requestKey === filter.requestKey && ACTIVE.has(record.status));
      list.sort((a, b) => b.createdAt - a.createdAt);
      return ok(filter.limit ? list.slice(0, filter.limit) : list);
    },
    async update(id, patch) {
      const record = records.get(id);
      if (!record) return err(NotFoundError({ entity: 'render', id }));
      const next = { ...record, ...patch };
      records.set(id, next);
      return ok(next);
    },
  };
}

/** The shell the engine renders with, or why there is none. */
export function evalShell(): Result<string> {
  const packageDir = renderPackageDir();
  return resolveHeadlessShell({
    ...(process.env.TAALCUT_HEADLESS_SHELL ? { explicit: process.env.TAALCUT_HEADLESS_SHELL } : {}),
    development: true,
    ...(packageDir ? { packageDir } : {}),
  });
}

export interface EvalEngine {
  readonly deps: RenderEngineDeps;
  readonly store: ReturnType<typeof memoryRenderStore>;
  readonly timelines: Map<TimelineId, Timeline>;
  readonly assets: Map<AssetId, string>;
}

export function evalEngine(root: string, media: MediaContext, shell: string): EvalEngine {
  const store = memoryRenderStore();
  const timelines = new Map<TimelineId, Timeline>();
  const assets = new Map<AssetId, string>();
  const packageDir = renderPackageDir();
  const fonts = resolveFontDir({ development: true, ...(packageDir ? { packageDir } : {}) });
  if (!fonts.ok) throw new Error(`No caption fonts: ${fonts.error.detail ?? fonts.error.code}`);
  let measurer: Promise<TextMeasurer> | undefined;
  const deps: RenderEngineDeps = {
    store,
    timelines: {
      async get(id) {
        const found = timelines.get(id);
        return found ? ok(found) : err(NotFoundError({ entity: 'timeline', id }));
      },
      async update(id, mutate) {
        const found = timelines.get(id);
        if (!found) return err(NotFoundError({ entity: 'timeline', id }));
        const next = { ...mutate(found), revision: found.revision + 1 };
        timelines.set(id, next);
        return ok(next);
      },
    },
    assets: {
      async original(assetId) {
        const path = assets.get(assetId);
        if (!path) return ok(null);
        const info = await stat(path).catch(() => null);
        return ok(info ? { path, size: info.size, mtimeMs: info.mtimeMs } : null);
      },
      proxy: async () => ok(null),
    },
    media,
    shell: async () => ok(shell),
    fontsDir: fonts.value,
    measurer: () => (measurer ??= createTextMeasurer(fonts.value)),
    folders: {
      preview: join(root, 'cache', 'preview'),
      work: join(root, 'cache', 'work'),
      conform: join(root, 'cache', 'conform'),
      renders: join(root, 'renders'),
    },
    clock: systemClock,
    events: { emit: () => undefined },
    log: process.env.TAALCUT_EVAL_RENDER_LOG ? (line) => console.error(`[render] ${line}`) : () => undefined,
  };
  return { deps, store, timelines, assets };
}
