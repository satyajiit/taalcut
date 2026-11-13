// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.captureFrame (RenderWorker.captureFrame): one frame as a JPEG,
 * what is on screen at it, and where Chrome laid out each caption and text.
 *
 * - 'preview': a still bundle (the timeline with each video clip as a still
 *   of the instant shown, pulled from its proxy or original) captured by the
 *   pinned shell, so text, captions and transitions are drawn by the same
 *   composition the export uses.
 * - 'render': frame k decoded from the render's own file, what the user will
 *   see. Text boxes come from the same still bundle without pictures, and
 *   only while the timeline is still at the render's revision (it is the
 *   only revision TimelineAccess can read); otherwise they are left empty.
 *
 * Text boxes are in canvas pixels (1080×1920) whatever size the picture is.
 */
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { z } from 'zod';
import {
  CancelledError,
  captureFrameInputSchema,
  captureFrameOutputSchema,
  ConflictError,
  err,
  NotFoundError,
  ok,
  RationalTime,
  ValidationError,
  type AsyncResult,
  type CaptureFrameInput,
  type CaptureFrameOutput,
  type ExportPreset,
  type ExportPresetId,
  type RenderId,
  type Result,
  type Timeline,
} from '@taalcut/core';
import { createCompositionFonts } from '../captions/fonts';
import { layoutCue } from '../captions/layout';
import { compileComposition, type CaptionLayout } from '../compile/composition';
import { previewLook } from './preview-look';
import { RenderNotReady } from '../errors';
import { planTimeline } from '../plan/render-plan';
import type { RenderPlan } from '../plan/types';
import { canvasPreset } from '../presets/canvas-preset';
import { DEFAULT_PRESET_ID, isPortraitPreset, presetFor } from '../presets/presets.v1';
import { renderWorkFile } from '../store/paths';
import type { ProbedTextBox } from '../types';
import { writeBundle } from './bundle-writer';
import { openStillSession } from './still-session';
import type { RenderEngineDeps } from './deps';
import { playableFile } from './playable-file';
import {
  blackStill,
  decodeFrame,
  extractStill,
  finishJpeg,
  isBrowserStill,
  stillSeconds,
  stillTimeline,
  textBoxesOf,
  visibleAt,
  type VisibleAt,
} from './stills';

const NONE: VisibleAt = { clips: [], captions: [], texts: [] };

export interface CaptureFrameOptions {
  readonly signal?: AbortSignal;
}

interface StillMedia {
  readonly file: string;
  readonly key: string;
  readonly ext: string;
}

interface StillCapture {
  /** The shell's screenshot of the frame (pictures mode), else null. */
  readonly shot: string | null;
  readonly boxes: readonly ProbedTextBox[];
}

/** Media for the still bundle: the frame's own stills for clips on screen (pictures mode), black for the rest. */
async function stillMedia(
  deps: RenderEngineDeps,
  plan: RenderPlan,
  frame: number,
  dir: string,
  pictures: boolean,
  signal?: AbortSignal,
  original = false,
): AsyncResult<Map<string, StillMedia>> {
  const black = join(dir, 'black.jpg');
  const made = await blackStill(deps.media, black, signal);
  if (!made.ok) return made;
  const media = new Map<string, StillMedia>();
  const blackEntry: StillMedia = { file: black, key: 'black', ext: 'jpg' };
  for (const visual of plan.visuals) {
    if (!visual.enabled) continue;
    const onScreen = visual.visible.start <= frame && frame < visual.visible.end;
    const source =
      pictures && onScreen
        ? await playableFile(deps.assets, visual.assetId, !original && visual.kind === 'video')
        : null;
    if (!source) {
      if (original && pictures && onScreen)
        return err(NotFoundError({ entity: 'asset', id: visual.assetId }));
      media.set(visual.id, blackEntry);
      continue;
    }
    if (visual.kind === 'image' && isBrowserStill(source)) {
      const ext = extname(source).slice(1).toLowerCase();
      media.set(visual.id, { file: source, key: `still:${visual.id}:${source}`, ext });
      continue;
    }
    const file = join(dir, `${visual.id}.jpg`);
    const seconds = visual.kind === 'image' ? null : stillSeconds(visual, frame, plan.rate);
    const extracted = await extractStill(deps.media, source, seconds, file, signal);
    if (original && !extracted.ok) return extracted;
    media.set(
      visual.id,
      extracted.ok ? { file, key: `still:${visual.id}:${frame}`, ext: 'jpg' } : blackEntry,
    );
  }
  return ok(media);
}

/** The still bundle of `timeline` at `frame`, captured: a screenshot when `pictures`, and the probed text. */
async function captureStill(
  deps: RenderEngineDeps,
  timeline: Timeline,
  plan: RenderPlan,
  frame: number,
  preset: ExportPreset,
  work: string,
  pictures: boolean,
  signal?: AbortSignal,
  original = false,
): AsyncResult<StillCapture> {
  const stillsDir = join(work, 'stills');
  await mkdir(stillsDir, { recursive: true });
  const media = await stillMedia(deps, plan, frame, stillsDir, pictures, signal, original);
  if (!media.ok) return media;
  const measurer = await deps.measurer();
  const entries = new Map(
    [...media.value].map(([id, entry]) => [id, { ...entry, mediaStart: RationalTime.zero(plan.rate) }]),
  );
  const captionLayout: CaptionLayout = (text, style, safe, language, canvasHeight) =>
    layoutCue(text, style, measurer, safe, language, canvasHeight);
  const look = await previewLook(deps, timeline, preset, entries, captionLayout);
  if (!look.ok) return look;
  const compiled = compileComposition(stillTimeline(timeline), {
    ...look.value,
    variant: 'export',
    preset,
    burnCaptions: true,
    media: (visual) => {
      const entry = media.value.get(visual.id);
      return entry ? { ...entry, mediaStart: RationalTime.zero(plan.rate) } : undefined;
    },
    fonts: createCompositionFonts(deps.fontsDir, measurer),
    captionLayout,
  });
  if (!compiled.ok) return compiled;
  const bundleDir = join(work, 'bundle');
  await writeBundle(compiled.value, bundleDir);
  if (signal?.aborted) return err(CancelledError());
  const session = await openStillSession(deps, bundleDir, timeline, preset);
  if (!session.ok) return session;
  try {
    let shot: string | null = null;
    if (pictures) {
      const captured = await session.value.screenshot(frame);
      if (!captured.ok) return captured;
      shot = join(work, 'shot.jpg');
      await writeFile(shot, captured.value);
    }
    const boxes = await session.value.probeText(frame);
    if (!boxes.ok) return boxes;
    return ok({ shot, boxes: boxes.value });
  } finally {
    await session.value.close();
  }
}

/**
 * The render's record and the file to decode, when it belongs to the project and has one to show. A render that
 * needs attention (a draft whose QA failed) keeps its file in its work folder, never delivered (finalize.ts): the
 * Reviewer looks at that one.
 */
async function renderFile(
  deps: RenderEngineDeps,
  request: z.output<typeof captureFrameInputSchema>,
  renderId: RenderId,
) {
  const record = await deps.store.get(renderId);
  if (!record.ok) return record;
  const value = record.value;
  if (
    value.projectId !== request.projectId ||
    value.timelineId !== request.timelineId ||
    value.deletedAt !== null
  )
    return err(NotFoundError({ entity: 'render', id: renderId }));
  if (value.status === 'ready' && value.filePath) return ok({ record: value, file: value.filePath });
  if (value.status === 'needsAttention') {
    const file = value.filePath ?? renderWorkFile(deps.folders, value.id);
    const there = await access(file).then(
      () => true,
      () => false,
    );
    if (there) return ok({ record: value, file });
  }
  return err(RenderNotReady({ status: value.status }));
}

/** The preset the frame is laid out for and the one drawn over it, if asked. */
function framePresets(
  overlayPresetId: ExportPresetId | undefined,
  canvas: Timeline['canvas'],
): Result<{ preset: ExportPreset; overlay: ExportPreset | null }> {
  if (overlayPresetId === undefined)
    return ok({ preset: canvasPreset(presetFor(DEFAULT_PRESET_ID), canvas), overlay: null });
  const preset = presetFor(overlayPresetId);
  // A landscape preset reframes the timeline (P3-V2): capture a frame of its render instead.
  if (!isPortraitPreset(preset)) return err(ValidationError({ field: 'overlayPresetId' }));
  return ok({ preset, overlay: preset });
}

export async function captureFrame(
  deps: RenderEngineDeps,
  input: CaptureFrameInput,
  options: CaptureFrameOptions = {},
): AsyncResult<CaptureFrameOutput> {
  const parsed = captureFrameInputSchema.safeParse(input);
  if (!parsed.success)
    return err(ValidationError({ field: 'input' }, { detail: z.prettifyError(parsed.error) }));
  const request = parsed.data;
  const { signal } = options;
  if (signal?.aborted) return err(CancelledError());
  const timeline = await deps.timelines.get(request.timelineId);
  if (!timeline.ok) return timeline;
  if (timeline.value.projectId !== request.projectId)
    return err(NotFoundError({ entity: 'timeline', id: request.timelineId }));
  const plan = planTimeline(timeline.value);
  if (!plan.ok) return plan;
  const presets = framePresets(request.overlayPresetId, timeline.value.canvas);
  if (!presets.ok) return presets;
  const { preset, overlay } = presets.value;
  const work = await mkdtemp(join(tmpdir(), 'taalcut-frame-'));
  try {
    let picture: string;
    let boxes: readonly ProbedTextBox[] = [];
    let visible = NONE;
    let rate = timeline.value.canvas.rate;
    if (request.source.kind === 'preview') {
      if (request.timelineRevision !== undefined && request.timelineRevision !== timeline.value.revision)
        return err(ConflictError({ entity: 'timeline', id: request.timelineId }));
      if (request.frame >= plan.value.durationFrames) return err(ValidationError({ field: 'frame' }));
      const still = await captureStill(
        deps,
        timeline.value,
        plan.value,
        request.frame,
        preset,
        work,
        true,
        signal,
        request.original,
      );
      if (!still.ok) return still;
      picture = still.value.shot!;
      boxes = still.value.boxes;
      visible = visibleAt(plan.value, request.frame);
    } else {
      const found = await renderFile(deps, request, request.source.renderId);
      if (!found.ok) return found;
      const record = found.value.record;
      rate = record.rate;
      if (request.frame >= record.durationFrames) return err(ValidationError({ field: 'frame' }));
      picture = join(work, 'frame.png');
      const decoded = await decodeFrame(deps.media, found.value.file, request.frame, rate, picture, signal);
      if (!decoded.ok) return decoded;
      if (record.timelineRevision === timeline.value.revision) {
        const still = await captureStill(
          deps,
          timeline.value,
          plan.value,
          request.frame,
          preset,
          work,
          false,
          signal,
        );
        if (!still.ok) return still;
        boxes = still.value.boxes;
        visible = visibleAt(plan.value, request.frame);
      }
    }
    const jpeg = await finishJpeg(deps.media, picture, {
      canvas: { width: preset.width, height: preset.height },
      maxDimension: request.maxDimension,
      overlay,
      ...(signal ? { signal } : {}),
    });
    if (!jpeg.ok) return jpeg;
    return ok(
      captureFrameOutputSchema.parse({
        frame: request.frame,
        at: RationalTime.of(request.frame, rate),
        mimeType: 'image/jpeg',
        dataBase64: jpeg.value.data.toString('base64'),
        width: jpeg.value.width,
        height: jpeg.value.height,
        visible,
        textBoxes: textBoxesOf(boxes, preset.safe),
      }),
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
