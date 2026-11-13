// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The real render system (P2-Q3): each golden as a Timeline v1 over
 * strip-coded source clips (src/render/real-*.ts), exported by
 * @taalcut/render's engine exactly as the app's render process does it:
 * conform, compose, capture with the pinned headless shell, VideoToolbox
 * encode, mix at −14 LUFS, finish and the QA gate (P2-M8). The engine's file
 * is then read back for the checker: the strip band, scaled to the golden's
 * size into a lossless file at `outPath`, and the sound as a mono WAV beside
 * it. `qaPassed` is the export's first QA verdict (passed or passed with
 * warnings), the tracked first-pass share.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { newId, type AssetId, type ExportRequest, type ProjectId, type RenderId } from '@taalcut/core';
import { runFfmpeg, type MediaContext } from '@taalcut/media';
import { createLiveRenders, presetFor, runExport, workFolder } from '@taalcut/render';
import { evalEngine } from '../render/real-engine';
import { SOURCE_HEIGHT, SOURCE_WIDTH, writeSourceClip } from '../render/real-sources';
import { goldenTimeline } from '../render/real-timeline';
import { wavPathFor } from '../render/paths';
import { applyCutShift, parseRenderGolden, type RenderGolden } from '../render/schema';
import { type RenderOutput, type RenderQaOutcome, type RenderRequest, type RenderSystem } from './types';

export interface ExportRenderOptions {
  readonly media: MediaContext;
  /** chrome-headless-shell 152 (evalShell()). */
  readonly shell: string;
  /** Where sources, the engine's caches and renders go. */
  readonly workDir: string;
  /** Each export's QA outcome (for the CLI's note). */
  readonly onQa?: (goldenId: string, outcome: RenderQaOutcome) => void;
}

/** Output rows holding the strip: the source's 36-row band at 3×, a few rows in from each edge. */
const BAND = { top: 6, rows: 96 };
const FIRST_PASS = new Set(['passed', 'passedWithWarnings']);

async function readBack(
  media: MediaContext,
  file: string,
  golden: RenderGolden,
  outPath: string,
): Promise<void> {
  const scale = 1080 / SOURCE_WIDTH;
  if (1920 / SOURCE_HEIGHT !== scale) throw new Error('sources must be 9:16');
  const picture = await runFfmpeg(media, [
    '-y',
    '-i',
    file,
    '-vf',
    `crop=1080:${BAND.rows}:0:${BAND.top},scale=${golden.width}:${golden.height}:flags=neighbor,format=rgb24`,
    '-an',
    '-c:v',
    'ffv1',
    outPath,
  ]);
  if (!picture.ok) throw new Error(`strip read-back: ${picture.error.detail ?? picture.error.code}`);
  const sound = await runFfmpeg(media, [
    '-y',
    '-i',
    file,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '48000',
    '-c:a',
    'pcm_s16le',
    wavPathFor(outPath),
  ]);
  if (!sound.ok) throw new Error(`sound read-back: ${sound.error.detail ?? sound.error.code}`);
}

export function exportRenderSystem(options: ExportRenderOptions): RenderSystem {
  let runs = 0;
  return {
    async render(request: RenderRequest): Promise<RenderOutput> {
      const parsed = parseRenderGolden(request.timeline, request.goldenId);
      const golden =
        request.cutShiftFrames === undefined ? parsed : applyCutShift(parsed, request.cutShiftFrames);
      const root = join(options.workDir, `${golden.id}-${++runs}`);
      mkdirSync(root, { recursive: true });
      const engine = evalEngine(root, options.media, options.shell);
      const sources: { assetId: AssetId; frames: number }[] = [];
      for (const index of golden.clips.keys()) {
        const written = await writeSourceClip(options.media, join(root, 'sources'), golden, index);
        const assetId = newId<'Asset'>() as AssetId;
        engine.assets.set(assetId, written.path);
        sources.push({ assetId, frames: written.frames });
      }
      const timeline = goldenTimeline(golden, sources);
      engine.timelines.set(timeline.id, timeline);
      const preset = presetFor('device');
      const exportRequest: ExportRequest = {
        projectId: timeline.projectId,
        timelineId: timeline.id,
        timelineRevision: timeline.revision,
        presetId: preset.id,
        rate: timeline.canvas.rate,
        captions: { burnIn: true, sidecars: [] },
        notify: false,
        contentCredentials: { add: false },
        includeBumpers: true,
      };
      const renderId = newId<'Render'>() as RenderId;
      const created = await engine.store.create({
        id: renderId,
        projectId: timeline.projectId as ProjectId,
        timelineId: timeline.id,
        timelineRevision: timeline.revision,
        presetId: preset.id,
        status: 'queued',
        jobId: null,
        name: golden.id,
        width: preset.width,
        height: preset.height,
        rate: timeline.canvas.rate,
        durationFrames: 0,
        bytes: null,
        music: timeline.music.path,
        captions: exportRequest.captions,
        qa: null,
        supersedes: null,
        notify: false,
        error: null,
        credentials: { added: false, state: null },
        batchId: null,
        createdAt: Date.now(),
        finishedAt: null,
        deletedAt: null,
        request: exportRequest,
        filePath: null,
        compositionHash: null,
        qaReport: null,
        requestKey: renderId,
      });
      if (!created.ok) throw new Error(created.error.code);
      const result = await runExport(engine.deps, createLiveRenders(), { renderId, request: exportRequest });
      if (!result.ok) throw new Error(`${golden.id}: ${result.error.code} ${result.error.detail ?? ''}`);
      const record = await engine.store.get(renderId);
      if (!record.ok) throw new Error(record.error.code);
      // A render QA didn't pass waits in its work folder (render SPEC 17); the file is the same either way.
      const file = record.value.filePath ?? join(workFolder(engine.deps, renderId), 'final.mp4');
      mkdirSync(join(request.outPath, '..'), { recursive: true });
      await readBack(options.media, file, golden, request.outPath);
      const verdict = record.value.qaReport?.verdict;
      const checks = record.value.qaReport?.checks ?? [];
      const ids = (status: string) =>
        checks.filter((check) => check.status === status).map((check) => check.id);
      options.onQa?.(golden.id, { verdict: verdict ?? null, failed: ids('fail'), warned: ids('warn') });
      return { videoPath: request.outPath, qaPassed: verdict !== undefined && FIRST_PASS.has(verdict) };
    },
  };
}
