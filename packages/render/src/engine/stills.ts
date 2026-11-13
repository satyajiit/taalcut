// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Single frames for captureFrame and the renders router's posters: what is
 * on screen at frame k (from the plan), stills pulled from a clip's file at
 * the instant frame k shows, frame k decoded from a finished render, and the
 * last step every picture goes through (scale to the caller's size, draw a
 * preset's safe rect and platform overlays, encode a JPEG under 2 MiB).
 *
 * The pinned shell has no H.264 decoder, so a frame captured from a
 * composition uses a still bundle: the same timeline with every video clip
 * turned into a still of the instant shown (stillTimeline).
 */
import { writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  err,
  type FrameRate,
  ok,
  RationalTime,
  type AsyncResult,
  type ExportPreset,
  type Rect,
  type Timeline,
} from '@taalcut/core';
import { extractFrame, runFfmpeg, type MediaContext } from '@taalcut/media';
import { CaptureFailed } from '../errors';
import { sourceFramesAt, visualCurve } from '../plan/speed-curve';
import type { PlannedVisual, RenderPlan } from '../plan/types';
import type { ProbedTextBox } from '../types';

/** captureFrameOutputSchema: at most 2 MiB of image (2 796 204 base64 characters). */
export const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const VISIBLE_LIMITS = { clips: 8, captions: 4, texts: 16 } as const;
export const MAX_TEXT_BOXES = 32;
/** The JPEG qualities tried in turn (FFmpeg's -q:v, lower is better) until the frame fits. */
const JPEG_QUALITIES = [2, 4, 7, 12, 20, 31] as const;
/** Formats Chromium draws in an <img> as they are; anything else is converted to JPEG first. */
const BROWSER_STILLS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

export interface VisibleAt {
  readonly clips: string[];
  readonly captions: string[];
  readonly texts: string[];
}

const within = (span: { readonly start: number; readonly end: number }, frame: number) =>
  span.start <= frame && frame < span.end;

/** The clips, caption cues and text items on screen at `frame`, in drawing order, capped as the contract caps them. */
export function visibleAt(plan: RenderPlan, frame: number): VisibleAt {
  const clips = plan.visuals
    .filter((visual) => visual.enabled && within(visual.visible, frame))
    .map((visual) => visual.id);
  const captions = (plan.captions?.cues ?? [])
    .filter((cue) => {
      const start = RationalTime.toFrames(cue.range.start, plan.rate);
      return within({ start, end: start + RationalTime.toFrames(cue.range.duration, plan.rate) }, frame);
    })
    .map((cue) => cue.id);
  const texts = plan.texts.filter((text) => within(text.span, frame)).map((text) => text.id);
  return {
    clips: clips.slice(0, VISIBLE_LIMITS.clips),
    captions: captions.slice(0, VISIBLE_LIMITS.captions),
    texts: texts.slice(0, VISIBLE_LIMITS.texts),
  };
}

/**
 * The timeline with every video clip on the picture track drawn as a still of the same asset, so a
 * composition of stills lays out exactly like the real one (same ids, windows, transitions, text).
 */
export function stillTimeline(timeline: Timeline): Timeline {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.kind !== 'video'
        ? track
        : {
            ...track,
            items: track.items.map((item) =>
              item.type === 'clip' && item.media.kind === 'video' ? stillClip(item) : item,
            ),
          },
    ),
  } as Timeline;
}

function stillClip(item: Extract<Timeline['tracks'][0]['items'][number], { type: 'clip' }>) {
  // Native layouts retain the video's source coordinates; the JPEG media entry still draws as an image.
  if (item.visualLayout) return item;
  const { holdFrame: _hold, ...clip } = item;
  return { ...clip, media: { kind: 'image' as const, assetId: clip.media.assetId } };
}

/**
 * Source seconds whose frame a video clip shows at render frame `frame`. A quarter frame early: an
 * accurate FFmpeg seek returns the first frame starting at or after the time, which is then the
 * frame on screen when source and output rates match. Ramps follow the clip's exact curve, as the
 * conformed segment does.
 */
export function stillSeconds(visual: PlannedVisual, frame: number, rate: FrameRate): number {
  if (visual.holdFrame)
    return Math.max(
      0,
      RationalTime.toSeconds(visual.holdFrame) -
        (0.25 * visual.holdFrame.rate.den) / visual.holdFrame.rate.num,
    );
  const curve = visualCurve(visual, rate);
  const offset = (sourceFramesAt(curve, frame - visual.visible.start - 0.25) * rate.den) / rate.num;
  return Math.max(0, RationalTime.toSeconds(visual.sourceIn) + offset);
}

/** Seconds that select frame `frame` of a constant-rate file with an accurate seek: half a frame early. */
export function frameSeekSeconds(frame: number, rate: FrameRate): number {
  return Math.max(0, ((frame - 0.5) * rate.den) / rate.num);
}

/** Whether `path` can go into a still bundle as it is. */
export const isBrowserStill = (path: string) => BROWSER_STILLS.has(extname(path).toLowerCase());

function failed(error: { code: string; detail?: string }) {
  return err(CaptureFailed(undefined, { detail: `${error.code}: ${error.detail ?? ''}`.slice(0, 2000) }));
}

/** One frame of `source` at `seconds` (null: a still image's only frame) as a JPEG at most 1920 on its long side. */
export async function extractStill(
  ctx: MediaContext,
  source: string,
  seconds: number | null,
  out: string,
  signal?: AbortSignal,
): AsyncResult<void> {
  const frame = await extractFrame(
    source,
    { value: Math.max(0, Math.round((seconds ?? 0) * 1_000_000)), rate: 1_000_000 },
    ctx,
    {
      format: 'jpeg',
      maxDimension: 1920,
      jpegQuality: 2,
      ...(signal ? { signal } : {}),
    },
  );
  if (!frame.ok) return failed(frame.error);
  await writeFile(out, frame.value.data);
  return ok(undefined);
}

/** A small black JPEG: what a still bundle shows for clips not on screen at the frame. */
export async function blackStill(ctx: MediaContext, out: string, signal?: AbortSignal): AsyncResult<void> {
  const run = await runFfmpeg(
    ctx,
    ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=16x16', '-frames:v', '1', '-pix_fmt', 'yuvj420p', out],
    { holdsVideoSession: false, timeoutMs: 30_000, ...(signal ? { signal } : {}) },
  );
  return run.ok ? ok(undefined) : failed(run.error);
}

/** Frame `frame` of a finished render (constant `rate`, timestamps from zero) as a lossless PNG. */
export async function decodeFrame(
  ctx: MediaContext,
  file: string,
  frame: number,
  rate: FrameRate,
  out: string,
  signal?: AbortSignal,
): AsyncResult<void> {
  const run = await runFfmpeg(
    ctx,
    ['-y', '-ss', frameSeekSeconds(frame, rate).toFixed(6), '-i', file, '-frames:v', '1', '-an', out],
    { holdsVideoSession: false, timeoutMs: 60_000, ...(signal ? { signal } : {}) },
  );
  return run.ok ? ok(undefined) : failed(run.error);
}

/** The size a canvas is scaled to so its long side is at most `maxDimension` (even, never enlarged). */
export function scaledSize(
  canvas: { readonly width: number; readonly height: number },
  maxDimension: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxDimension / Math.max(canvas.width, canvas.height));
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: even(canvas.width), height: even(canvas.height) };
}

/**
 * drawbox filters for a preset's layer at `scale`: platform overlays as translucent fills, then the
 * safe rect as a green outline on top. Empty without a preset.
 */
export function overlayFilters(preset: ExportPreset | null, scale: number): string[] {
  if (!preset) return [];
  const box = (rect: Rect) =>
    `x=${Math.round(rect.x * scale)}:y=${Math.round(rect.y * scale)}:` +
    `w=${Math.max(1, Math.round(rect.width * scale))}:h=${Math.max(1, Math.round(rect.height * scale))}`;
  const thickness = Math.max(2, Math.round(4 * scale));
  return [
    ...preset.overlays.map((overlay) => `drawbox=${box(overlay.rect)}:color=black@0.35:t=fill`),
    `drawbox=${box(preset.safe)}:color=0x22c55e@0.95:t=${thickness}`,
  ];
}

export interface FinishedJpeg {
  readonly data: Buffer;
  readonly width: number;
  readonly height: number;
}

/**
 * The last step for every picture: `input` (a JPEG or PNG of the whole canvas) scaled to at most
 * `maxDimension`, the preset's layer drawn, encoded as a JPEG of at most MAX_FRAME_BYTES.
 */
export async function finishJpeg(
  ctx: MediaContext,
  input: string,
  options: {
    readonly canvas: { readonly width: number; readonly height: number };
    readonly maxDimension: number;
    readonly overlay: ExportPreset | null;
    readonly signal?: AbortSignal;
  },
): AsyncResult<FinishedJpeg> {
  const size = scaledSize(options.canvas, options.maxDimension);
  const scale = size.width / options.canvas.width;
  const filters = [
    `scale=${size.width}:${size.height}:flags=bicubic`,
    ...overlayFilters(options.overlay, scale),
    'format=yuvj420p',
  ];
  for (const quality of JPEG_QUALITIES) {
    const run = await runFfmpeg(
      ctx,
      [
        '-i',
        input,
        '-frames:v',
        '1',
        '-vf',
        filters.join(','),
        '-c:v',
        'mjpeg',
        '-q:v',
        String(quality),
        '-f',
        'image2pipe',
        'pipe:1',
      ],
      {
        holdsVideoSession: false,
        timeoutMs: 60_000,
        maxStdoutBytes: 4 * MAX_FRAME_BYTES,
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );
    if (!run.ok) return failed(run.error);
    if (run.value.stdout.length <= MAX_FRAME_BYTES) return ok({ data: run.value.stdout, ...size });
  }
  return err(CaptureFailed(undefined, { detail: 'frame does not fit in 2 MiB at any quality' }));
}

const inside = (box: Rect, safe: Rect) =>
  box.x >= safe.x &&
  box.y >= safe.y &&
  box.x + box.width <= safe.x + safe.width &&
  box.y + box.height <= safe.y + safe.height;

/** Probed boxes as the contract's textBoxes: canvas pixels, whether each sits inside `safe`, at most 32. */
export function textBoxesOf(
  probed: readonly ProbedTextBox[],
  safe: Rect,
): { kind: 'caption' | 'text'; id: string; box: Rect; lines: number; inSafeZone: boolean }[] {
  return probed
    .filter((entry) => !entry.program || entry.textBounds !== undefined)
    .slice(0, MAX_TEXT_BOXES)
    .map((entry) => ({
      // The contract names captions and text; a motion graphic is text on screen.
      kind: entry.kind === 'caption' ? 'caption' : 'text',
      id: entry.id.slice(0, 64),
      box: {
        x: Math.max(0, Math.round((entry.textBounds ?? entry.box).x)),
        y: Math.max(0, Math.round((entry.textBounds ?? entry.box).y)),
        width: Math.max(1, Math.round((entry.textBounds ?? entry.box).width)),
        height: Math.max(1, Math.round((entry.textBounds ?? entry.box).height)),
      },
      lines: Math.max(0, Math.round(entry.lines)),
      inSafeZone: inside(entry.textBounds ?? entry.box, safe),
    }));
}
