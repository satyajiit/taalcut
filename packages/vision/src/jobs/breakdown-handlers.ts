// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Handlers for the breakdown's job kinds. `createVisionJobs` adds `breakdownJobRegistrations(deps)`. */
import { err, ok, registerJob, type JobContext, type JobRegistration } from '@taalcut/core';
import { buildContactSheet, type SheetLayout } from '../breakdown/contact-sheet';
import { detectCuts } from '../breakdown/detect-cuts';
import { readOverlays } from '../breakdown/overlays';
import { framesOf, frameOf, plainOnScreenText, plainRate } from '../breakdown/types';
import { OcrUnavailable } from '../errors';
import { probeSource } from '../media/frames';
import { sceneFallback } from '../media/scene';
import {
  BREAKDOWN_JOB_STAGES,
  visionContactSheetJob,
  visionDetectCutsJob,
  visionReadOverlaysJob,
  type ContactSheetJobInput,
} from './breakdown-kinds';
import type { VisionJobDeps } from './deps';

const MAX_OVERLAYS = 200;

export function breakdownJobRegistrations(deps: VisionJobDeps): JobRegistration[] {
  let sceneLogged = false;
  // scdet has no GPU path for these frames (ADR 0002): one compute.fallback record per process.
  const logScene = () => {
    if (sceneLogged) return;
    sceneLogged = true;
    deps.onFallback?.(sceneFallback());
  };

  return [
    registerJob(visionDetectCutsJob, async (input, context) => {
      stage(context, 0, BREAKDOWN_JOB_STAGES.detectingCuts);
      const range = await gridRange(deps, input.path, input.range, context.signal);
      if (!range.ok) return range;
      logScene();
      return detectCuts(
        input.path,
        { media: deps.media, ...(deps.embedder ? { embedder: deps.embedder } : {}) },
        {
          tier: deps.tier,
          sensitivity: input.sensitivity,
          signal: context.signal,
          progress: (fraction) => stage(context, fraction, BREAKDOWN_JOB_STAGES.detectingCuts),
          ...(range.value ? { range: range.value } : {}),
        },
      );
    }),

    registerJob(visionReadOverlaysJob, async (input, context) => {
      if (!deps.ocr) return err(OcrUnavailable({ language: input.languages[0] ?? 'en' }));
      stage(context, 0, BREAKDOWN_JOB_STAGES.readingText);
      const range = await gridRange(deps, input.path, input.range, context.signal);
      if (!range.ok) return range;
      const read = await readOverlays(
        input.path,
        { media: deps.media, ocr: deps.ocr },
        {
          fps: input.fps,
          languages: input.languages,
          signal: context.signal,
          progress: (fraction) => stage(context, fraction, BREAKDOWN_JOB_STAGES.readingText),
          ...(input.cutFrames ? { cutFrames: input.cutFrames } : {}),
          ...(range.value ? { range: range.value } : {}),
        },
      );
      if (!read.ok) return read;
      return ok({
        frameRate: plainRate(read.value.source.rate),
        overlays: read.value.overlays.slice(0, MAX_OVERLAYS).map(plainOnScreenText),
        truncated: read.value.overlays.length > MAX_OVERLAYS,
      });
    }),

    registerJob(visionContactSheetJob, async (input, context) => {
      stage(context, 0, BREAKDOWN_JOB_STAGES.makingContactSheet);
      const source = await probeSource(deps.media, input.path, context.signal);
      if (!source.ok) return source;
      const sheet = await buildContactSheet(
        input.path,
        { media: deps.media, tempDir: deps.tempDir },
        layoutOf(input.layout, source.value.rate),
        {
          signal: context.signal,
          ...(input.columns !== undefined ? { columns: input.columns } : {}),
          ...(input.tileLongSide !== undefined ? { tileLongSide: input.tileLongSide } : {}),
          ...(input.maxBytes !== undefined ? { maxBytes: input.maxBytes } : {}),
          ...(input.annotate !== undefined ? { annotate: input.annotate } : {}),
        },
      );
      if (!sheet.ok) return sheet;
      stage(context, 1, BREAKDOWN_JOB_STAGES.makingContactSheet);
      const { jpeg, layout, ...size } = sheet.value;
      return ok({
        jpegBase64: jpeg.toString('base64'),
        ...size,
        frameRate: plainRate(source.value.rate),
        layout: [...layout],
      });
    }),
  ];
}

function stage(context: JobContext, fraction: number, stageKey: string): void {
  context.progress({ fraction, stageKey });
}

/** A plain time range as grid frames of the file, or undefined for the whole file. */
async function gridRange(
  deps: VisionJobDeps,
  path: string,
  range: Parameters<typeof framesOf>[0] | undefined,
  signal: AbortSignal,
) {
  if (!range) return ok(undefined);
  const source = await probeSource(deps.media, path, signal);
  if (!source.ok) return source;
  return ok(framesOf(range, source.value.rate));
}

function layoutOf(layout: ContactSheetJobInput['layout'], rate: Parameters<typeof frameOf>[1]): SheetLayout {
  switch (layout.kind) {
    case 'frames':
      return layout;
    case 'shots':
      return layout;
    case 'times':
      return { kind: 'frames', frames: layout.at.map((at) => frameOf(at, rate)) };
    case 'strips':
      return { kind: 'strips', candidates: layout.candidates.map((at) => frameOf(at, rate)) };
  }
}
