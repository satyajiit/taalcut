// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A render engine's dependencies for integration tests: the in-memory
 * RenderStore, timelines and assets from maps, the bundled FFmpeg, the pinned shell, the committed fonts and a temporary
 * folder tree. Events are recorded for assertions.
 */
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import {
  ConflictError,
  err,
  NotFoundError,
  ok,
  systemClock,
  type AssetId,
  type TaalcutEvent,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import type { RenderEngineDeps } from '../../src/engine/deps';
import type { AssetFiles, TimelineAccess } from '../../src/ports';
import { FONTS_DIR, testMeasurer } from './fonts';
import { ffmpeg } from './media';
import { memoryRenderStore, type MemoryRenderStore } from './render-store';
import { FIXTURE_H264 } from './host-video';

/** A moving picture (testsrc2) with pink noise: QA's frozen-frame and sync checks have something to see. */
export async function movingClip(
  ctx: MediaContext,
  out: string,
  options: { frames: number; rate: string; size?: string; silent?: boolean },
): Promise<void> {
  await ffmpeg(ctx, [
    '-f',
    'lavfi',
    '-i',
    `testsrc2=s=${options.size ?? '1080x1920'}:r=${options.rate}`,
    '-f',
    'lavfi',
    '-i',
    options.silent ? 'anullsrc=r=48000:cl=stereo' : 'anoisesrc=color=pink:r=48000:a=0.25:seed=7',
    '-frames:v',
    String(options.frames),
    '-c:v',
    FIXTURE_H264,
    '-b:v',
    '8M',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-shortest',
    out,
  ]);
}

export function mapTimelines(timelines: Map<TimelineId, Timeline>): TimelineAccess {
  return {
    async get(id) {
      const found = timelines.get(id);
      return found ? ok(found) : err(NotFoundError({ entity: 'timeline', id }));
    },
    async update(id, mutate) {
      const found = timelines.get(id);
      if (!found) return err(NotFoundError({ entity: 'timeline', id }));
      const next = { ...mutate(found), revision: found.revision + 1 };
      if (timelines.get(id) !== found) return err(ConflictError({ entity: 'timeline', id }));
      timelines.set(id, next);
      return ok(next);
    },
  };
}

export function mapAssets(files: Map<AssetId, string>, proxies = new Map<AssetId, string>()): AssetFiles {
  return {
    async original(assetId) {
      const path = files.get(assetId);
      if (!path) return ok(null);
      const info = await stat(path).catch(() => null);
      return ok(info ? { path, size: info.size, mtimeMs: info.mtimeMs } : null);
    },
    proxy: async (assetId) => ok(proxies.get(assetId) ?? null),
  };
}

export interface TestEngine {
  readonly deps: RenderEngineDeps;
  readonly store: MemoryRenderStore;
  readonly timelines: Map<TimelineId, Timeline>;
  readonly assets: Map<AssetId, string>;
  readonly events: TaalcutEvent[];
}

export function testEngine(
  root: string,
  ctx: MediaContext,
  chromePath: string,
  overrides: Partial<RenderEngineDeps> = {},
): TestEngine {
  const store = memoryRenderStore();
  const timelines = new Map<TimelineId, Timeline>();
  const assets = new Map<AssetId, string>();
  const events: TaalcutEvent[] = [];
  let measurer: ReturnType<typeof testMeasurer> | undefined;
  const deps: RenderEngineDeps = {
    store,
    timelines: mapTimelines(timelines),
    assets: mapAssets(assets),
    media: ctx,
    shell: async () => ok(chromePath),
    fontsDir: FONTS_DIR,
    measurer: () => (measurer ??= testMeasurer()),
    folders: {
      preview: join(root, 'cache', 'preview'),
      work: join(root, 'cache', 'work'),
      conform: join(root, 'cache', 'conform'),
      renders: join(root, 'renders'),
    },
    clock: systemClock,
    events: {
      emit: (type, payload) => {
        events.push({ type, payload, at: Date.now() } as unknown as TaalcutEvent);
      },
    },
    ...overrides,
  };
  return { deps, store, timelines, assets, events };
}
