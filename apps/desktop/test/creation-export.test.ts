// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import {
  connectRpc,
  CREATION_COMMANDS,
  FrameRates,
  newId,
  ok,
  RationalTime,
  RenderStoreToken,
  renderExportJobInputSchema,
  renderWorkerOverRpc,
  serveRpc,
  systemClock,
  unwrap,
  UTILITY_CONTRACTS,
  type JobEnqueuer,
  type PublicJobSnapshot,
  type RenderWorker,
} from '@taalcut/core';
import type { CreationScene } from '@taalcut/agent';
import { runProcess } from '@taalcut/media';
import { createRenderCommands, decodeRgbFrame } from '@taalcut/render';
import { registerRenderPorts, renderTimelines, snapshotExport } from '../src/shared/render-ports';
import { renderPaths } from '../src/shared/render-paths';
import { composeRender } from '../src/utility/roots/render-root';
import { publishCreation } from '../src/utility/creation/publish';
import { creationMedia } from '../src/utility/creation/production-media';
import { checkpoint, creationWorld, draftProject, UI } from './helpers/creation';
import { testConfig } from './helpers/roots';
import { testFfmpeg } from './helpers/test-ffmpeg';

const binaries = await testFfmpeg('creation encoded export');

function exportQueue(worker: RenderWorker, signal: AbortSignal) {
  const running: Promise<unknown>[] = [];
  const enqueuer: JobEnqueuer = {
    async enqueue(request) {
      if (request.kind === 'render.export') {
        const input = renderExportJobInputSchema.parse(request.input);
        running.push(worker.export(input, { signal }));
      }
      const snapshot: PublicJobSnapshot = {
        id: newId<'Job'>(),
        kind: request.kind,
        state: 'queued',
        priority: 'normal',
        resource: 'gpu',
        projectId: request.projectId ?? null,
        idempotencyKey: request.idempotencyKey ?? null,
        parentId: null,
        attempt: 1,
        maxAttempts: 1,
        progress: null,
        error: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        startedAt: null,
        finishedAt: null,
        nextAttemptAt: null,
      };
      return ok(snapshot);
    },
  };
  return { enqueuer, running };
}

function centroid(bytes: Uint8Array, width: number, colour: 'cyan' | 'yellow'): number {
  let sum = 0;
  let pixels = 0;
  for (let i = 0; i < bytes.length; i += 3) {
    const [r, g, b] = [bytes[i]!, bytes[i + 1]!, bytes[i + 2]!];
    const matches = colour === 'cyan' ? r < 90 && g > 150 && b > 150 : r > 180 && g > 140 && b < 100;
    if (matches) {
      sum += (i / 3) % width;
      pixels++;
    }
  }
  expect(pixels, `${colour} must be visibly present in the encoded frame`).toBeGreaterThan(15);
  return sum / pixels;
}

describe.skipIf(!binaries.ok)('Create automatic MP4 production', { timeout: 180_000 }, () => {
  it('exports all four native formats at 60 fps and preserves camera/cursor motion through encoded QA', async () => {
    const world = creationWorld();
    const before = await draftProject(world);
    const duration = RationalTime.of(120, FrameRates.fps60);
    const project = await checkpoint(world, before, {
      brief: { ...before.brief, formats: ['16:9', '9:16', '1:1', '4:5'], duration },
      draft: { ...before.draft!, beats: [{ ...before.draft!.beats[0]!, duration }], questions: [] },
    });
    unwrap(
      await world.bus.dispatch(
        CREATION_COMMANDS.approve,
        {
          projectId: project.projectId,
          revision: project.revision,
          draftRevision: project.draft!.revision,
        },
        UI,
      ),
    );
    const approved = unwrap(await world.store.get(project.projectId));
    const scenes: CreationScene[] = approved.brief.formats.map((format) => ({
      beatId: 'one',
      format,
      html: '<h1 id="one-title" data-hf-id="one-title">Launch</h1><div id="one-panel" data-hf-id="one-panel"></div>',
      css: '#one-title{position:absolute;left:160px;top:360px;width:300px;height:80px;margin:0px;font-size:56px;color:#ffffff;}#one-panel{position:absolute;left:160px;top:480px;width:180px;height:180px;background:#00ffff;}',
      animation: '',
    }));
    const masters: CreationScene[] = approved.brief.formats.map((format) => ({
      beatId: 'master',
      format,
      html: '<div id="master-cursor" data-hf-id="master-cursor"></div>',
      css: '#master-cursor{position:absolute;left:200px;top:760px;width:60px;height:60px;background:#ffff00;}',
      animation:
        "tl.fromTo('#master-cursor',{x:0},{x:600,duration:2,ease:'none'},0);tl.fromTo('#master-camera',{x:0},{x:240,duration:2,ease:'none'},0);",
    }));
    const timelineId = unwrap(
      await publishCreation(
        world.container,
        {
          project: approved,
          draft: approved.draft!,
          scenes,
          masterScenes: masters,
          voice: null,
        },
        new AbortController().signal,
      ),
    );
    registerRenderPorts(world.container);
    const config = testConfig('render', join(world.userData, 'library.db'), world.userData);
    const root = await composeRender(config);
    const { port1, port2 } = new MessageChannel();
    serveRpc(root.router, port1, { context: { caller: 'main' }, exposeDetail: true });
    const client = connectRpc(UTILITY_CONTRACTS.render, port2, { peer: 'render' }).client;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(150_000)]);
    const queue = exportQueue(
      renderWorkerOverRpc(() => client.worker),
      signal,
    );
    const store = world.container.resolve(RenderStoreToken);
    world.bus.register(
      ...createRenderCommands({
        store,
        enqueuer: queue.enqueuer,
        timelines: renderTimelines(world.container),
        snapshotExport: snapshotExport(world.container),
        clock: systemClock,
        folders: renderPaths(world.userData),
      }).all,
    );
    try {
      const result = await creationMedia(world.container).finalize(timelineId, signal);
      const records = unwrap(await store.list({ projectId: approved.projectId }));
      expect(
        result.ok,
        JSON.stringify({
          result,
          records: records.map((row) => ({
            status: row.status,
            error: row.error,
            qa: row.qaReport?.checks.filter((check) => check.status === 'fail'),
          })),
        }),
      ).toBe(true);
      expect(records).toHaveLength(4);
      const sizes: string[] = [];
      for (const record of records) {
        expect(record.status).toBe('ready');
        expect(record.qaReport?.checks.filter((check) => check.status === 'fail')).toEqual([]);
        expect(record.filePath).toMatch(/\.mp4$/);
        const media = unwrap(binaries);
        const probed = unwrap(
          await runProcess(
            media.ffprobe,
            [
              '-v',
              'error',
              '-show_entries',
              'stream=codec_type,width,height,r_frame_rate,nb_frames:format=duration',
              '-of',
              'json',
              record.filePath!,
            ],
            { timeoutMs: 30_000 },
          ),
        );
        const metadata = JSON.parse(probed.stdout.toString('utf8')) as {
          streams: {
            codec_type: string;
            width: number;
            height: number;
            r_frame_rate: string;
            nb_frames: string;
          }[];
          format: { duration: string };
        };
        const video = metadata.streams.find((stream) => stream.codec_type === 'video')!;
        sizes.push(`${video.width}x${video.height}`);
        expect(video.r_frame_rate).toBe('60/1');
        expect(Number(video.nb_frames)).toBe(120);
        expect(Number(metadata.format.duration)).toBeCloseTo(2, 1);
        const width = video.width / 10;
        const height = video.height / 10;
        const early = unwrap(
          await decodeRgbFrame({ binaries: media }, record.filePath!, { frame: 20, width, height }),
        );
        const late = unwrap(
          await decodeRgbFrame({ binaries: media }, record.filePath!, { frame: 100, width, height }),
        );
        expect(centroid(late, width, 'cyan') - centroid(early, width, 'cyan')).toBeCloseTo(16, 0);
        expect(centroid(late, width, 'yellow') - centroid(early, width, 'yellow')).toBeCloseTo(40, 0);
      }
      expect(sizes.sort()).toEqual(['1080x1080', '1080x1350', '1080x1920', '1920x1080']);
    } finally {
      controller.abort();
      await Promise.allSettled(queue.running);
      port1.close();
      port2.close();
      await root.container.dispose();
    }
  });
});
