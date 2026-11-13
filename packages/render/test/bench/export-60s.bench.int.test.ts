// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The SPEC's speed target (P2-M6): a 60 s 1080×1920 export, measured stage
 * by stage on this machine. A benchmark, not a correctness test: it runs
 * only with TAALCUT_BENCH=1 and prints its numbers (the M1 target needs an
 * M1 to measure on).
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FrameRate, newId } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { runExport } from '../../src/engine/export-run';
import { createLiveRenders } from '../../src/engine/live';
import { presetFor } from '../../src/presets/presets.v1';
import { movingClip, testEngine } from '../support/engine';
import { findTestMedia, mediaContext, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { captionTrackOf, makeTimeline } from '../support/timeline';

const bench = process.env.TAALCUT_BENCH === '1';
const media = bench ? await findTestMedia('bench') : { binaries: undefined };
const shell = bench ? findTestShell('bench') : { path: undefined };
const rate = FrameRate.of(30);

describe.skipIf(!bench || !media.binaries || !shell.path)(
  '60 s export benchmark',
  { timeout: 900_000 },
  () => {
    let ctx: MediaContext;
    let work: Awaited<ReturnType<typeof tempDir>>;
    const asset = newId<'Asset'>();

    beforeAll(async () => {
      ctx = mediaContext(media.binaries!);
      work = await tempDir('bench');
      await movingClip(ctx, join(work.dir, 'source.mp4'), { frames: 900, rate: '30' });
    });
    afterAll(async () => work?.dispose());

    it('renders 60 s at 1080×1920 30 fps with captions, end to end with QA', async () => {
      const engine = testEngine(join(work.dir, 'engine'), ctx, shell.path!);
      engine.assets.set(asset, join(work.dir, 'source.mp4'));
      const clips = Array.from({ length: 6 }, (_, index) => ({
        frames: 300,
        assetId: asset,
        sourceStart: (index * 97) % 590,
        mediaFrames: 900,
        mediaRate: rate,
        ...(index === 3 ? { transition: { kind: 'dissolve' as const, inFrames: 10, outFrames: 10 } } : {}),
      }));
      const cues = Array.from(
        { length: 30 },
        (_, index) => [index * 60, 55, `Caption number ${index + 1} here`] as const,
      );
      const timeline = makeTimeline({ rate, items: clips, captions: captionTrackOf(rate, cues) });
      engine.timelines.set(timeline.id, timeline);
      const preset = presetFor('device');
      const request = {
        projectId: timeline.projectId,
        timelineId: timeline.id,
        timelineRevision: timeline.revision,
        presetId: 'device' as const,
        captions: { burnIn: true, sidecars: [] },
        notify: false,
        contentCredentials: { add: false },
        includeBumpers: true,
      };
      const created = await engine.store.create({
        id: newId<'Render'>(),
        projectId: timeline.projectId,
        timelineId: timeline.id,
        timelineRevision: timeline.revision,
        presetId: 'device',
        status: 'queued',
        jobId: null,
        name: 'Benchmark',
        width: preset.width,
        height: preset.height,
        rate,
        durationFrames: 1800,
        bytes: null,
        music: 'platformSound',
        captions: request.captions,
        qa: null,
        supersedes: null,
        notify: false,
        error: null,
        credentials: { added: false, state: null },
        batchId: null,
        createdAt: Date.now(),
        finishedAt: null,
        deletedAt: null,
        request,
        filePath: null,
        compositionHash: null,
        qaReport: null,
        requestKey: 'bench',
      });
      if (!created.ok) throw new Error(created.error.code);
      const stages: { stage: string; at: number }[] = [];
      const started = performance.now();
      const result = await runExport(
        engine.deps,
        createLiveRenders(),
        { renderId: created.value.id, request },
        {
          onProgress: (progress) => {
            if (progress.stageKey && stages.at(-1)?.stage !== progress.stageKey)
              stages.push({ stage: progress.stageKey, at: performance.now() - started });
          },
        },
      );
      const total = performance.now() - started;
      if (!result.ok) throw new Error(`${result.error.code} ${result.error.detail ?? ''}`);
      const lines = stages.map((entry, index) => {
        const end = stages[index + 1]?.at ?? total;
        return `${entry.stage.replace('render.stage.', '').padEnd(12)} ${((end - entry.at) / 1000).toFixed(1)} s`;
      });
      process.stderr.write(
        `[bench] 60 s 1080×1920 export: ${(total / 1000).toFixed(1)} s, status ${result.value.status}\n${lines.join('\n')}\n`,
      );
      expect(['ready', 'needsAttention']).toContain(result.value.status);
    });
  },
);
