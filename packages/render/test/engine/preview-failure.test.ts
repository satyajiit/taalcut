// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId, unwrap } from '@taalcut/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPreviewSessions, PREVIEW_IDLE_MS } from '../../src/engine/previews';
import { producerRuntimeScript } from '../../src/engine/producer';
import type * as ProducerModule from '../../src/engine/producer';
import { fakeWorld } from '../router/fixtures';
import { makeTimeline } from '../support/timeline';

vi.mock('../../src/engine/producer', async (original) => {
  const real = await original<typeof ProducerModule>();
  return { ...real, producerRuntimeScript: vi.fn(real.producerRuntimeScript) };
});

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'taalcut-preview-failure-'));
  vi.mocked(producerRuntimeScript).mockClear();
});
afterEach(async () => rm(root, { recursive: true, force: true }));

it('cleans a partially written session when a runtime resource throws, then a new open can succeed', async () => {
  const world = await fakeWorld(join(root, 'world'));
  const assetId = newId<'Asset'>();
  const media = join(root, 'clip.mp4');
  // This unit test compiles the bundle without decoding or mixing footage.
  await writeFile(media, 'source media fixture');
  world.originals.set(assetId, media);
  const timeline = makeTimeline({ items: [{ frames: 30, sourceStart: 0, assetId }] });
  world.timelines.set(timeline.id, timeline);
  vi.mocked(producerRuntimeScript).mockResolvedValueOnce(join(root, 'missing-runtime.js'));
  const failing = createPreviewSessions(world.deps, { audio: false });
  await expect(failing.open(timeline.projectId, timeline.id)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readdir(world.deps.folders.preview)).toEqual([]);
  world.clock.advance(PREVIEW_IDLE_MS + 1);
  expect(await failing.sweep()).toBe(0);
  await failing.closeAll();

  const working = createPreviewSessions(world.deps, { audio: false });
  const session = unwrap(await working.open(timeline.projectId, timeline.id));
  const token = new URL(session.url).pathname.split('/')[1]!;
  const dir = join(world.deps.folders.preview, token);
  expect(await readFile(join(dir, '_hf/runtime.js'), 'utf8')).not.toHaveLength(0);
  expect(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))).toBeTypeOf('object');
  await working.closeAll();
  expect(await readdir(world.deps.folders.preview)).toEqual([]);
});
