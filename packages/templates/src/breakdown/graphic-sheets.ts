// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG1-READ, in the breakdown job: a picture of each kept overlay's life for the vision model that writes its brief
 * after the job (graphic-brief/). Every overlay the text stage kept is drawn, doubted ones included, because the model
 * also says when a reading is footage (a sign) rather than a graphic. One decode per few overlays; each sheet is a
 * PNG in the experiment, gone with it.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ok, RationalTime, type AsyncResult, type TextOverlay } from '@taalcut/core';
import { z } from 'zod';
import { composeSheet, encodePng, grow, type PixelRect, type RgbFrame } from '../overlay-look';
import type { StepContext } from './steps';

export const GRAPHIC_SHEETS = {
  /** The longest overlays first, at most this many (each is one model call later). */
  maxOverlays: 16,
  /** Shorter overlays (frames) are flashes: no sheet. */
  minFrames: 6,
  /** Overlays decoded together. */
  batch: 4,
  /** "Before" is this many frames before the words. */
  beforeFrames: 4,
  /** The analysis copy's own width. */
  maxDimension: 720,
  dir: 'graphics',
} as const;

const frame = z.int().nonnegative();
export const draftGraphicSheetSchema = z.object({
  overlayId: z.string().min(1).max(64),
  /** Experiment-relative PNG. */
  path: z.string().min(1).max(512),
  /** The close-ups' frames: before, entering, settled, exiting. */
  frames: z.array(frame).max(4),
  /** Frames the overlay's shape showed before its words (a typing indicator), when its design was read. */
  lead: frame.optional(),
});
export type DraftGraphicSheet = z.output<typeof draftGraphicSheetSchema>;

/** The four moments of an overlay on [start, end), clamped to the reel. */
export function momentsOf(start: number, end: number, total: number): number[] {
  const last = Math.max(start, end - 1);
  const clamp = (value: number) => Math.min(total - 1, Math.max(0, value));
  return [
    clamp(start - GRAPHIC_SHEETS.beforeFrames),
    clamp(Math.min(last, start + 1)),
    clamp(Math.round((start + last) / 2)),
    clamp(Math.max(start, end - 2)),
  ];
}

/** The overlay's region: its drawn shape when read, else its words, with room round it to see the scene. */
export function regionOf(overlay: TextOverlay, width: number, height: number): PixelRect {
  const box = overlay.design?.shape ?? overlay.box;
  const rect = {
    left: box.x * width,
    top: box.y * height,
    right: (box.x + box.width) * width,
    bottom: (box.y + box.height) * height,
  };
  const h = rect.bottom - rect.top;
  const w = rect.right - rect.left;
  const grown = grow(
    rect,
    { x: Math.max(w * 0.35, h * 1.5), y: Math.max(h * 1.2, 12) },
    { left: 0, top: 0, right: width, bottom: height },
  );
  return {
    left: Math.floor(grown.left),
    top: Math.floor(grown.top),
    right: Math.max(Math.floor(grown.left) + 1, Math.ceil(grown.right)),
    bottom: Math.max(Math.floor(grown.top) + 1, Math.ceil(grown.bottom)),
  };
}

/** Sheets for the overlays worth a brief; none without the media's pixels. A failed batch is a warning. */
export async function makeGraphicSheets(
  ctx: StepContext,
  overlays: readonly TextOverlay[],
  leads: Readonly<Record<string, number>>,
): AsyncResult<{ sheets: DraftGraphicSheet[]; warnings: string[] }> {
  const pixels = ctx.analysers.media.framePixels;
  if (!pixels || overlays.length === 0) return ok({ sheets: [], warnings: [] });
  const frameOf = (time: RationalTime) => RationalTime.toFrames(time, ctx.rate, 'round');
  const wanted = overlays
    .filter((overlay) => overlay.box.width > 0 && overlay.box.height > 0)
    .filter((overlay) => frameOf(overlay.duration) >= GRAPHIC_SHEETS.minFrames)
    .sort((a, b) => b.duration.value - a.duration.value)
    .slice(0, GRAPHIC_SHEETS.maxOverlays)
    .sort((a, b) => a.start.value - b.start.value);
  const dir = join(ctx.dir, GRAPHIC_SHEETS.dir);
  await mkdir(dir, { recursive: true });
  const sheets: DraftGraphicSheet[] = [];
  let failed = 0;
  for (let from = 0; from < wanted.length; from += GRAPHIC_SHEETS.batch) {
    if (ctx.signal.aborted) break;
    const batch = wanted.slice(from, from + GRAPHIC_SHEETS.batch).map((overlay) => {
      const start = frameOf(overlay.start);
      return { overlay, moments: momentsOf(start, start + frameOf(overlay.duration), ctx.total) };
    });
    const frames = [...new Set(batch.flatMap((item) => item.moments))].sort((a, b) => a - b);
    const got = await pixels(ctx.path, frames, {
      rate: ctx.rate,
      maxDimension: GRAPHIC_SHEETS.maxDimension,
      signal: ctx.signal,
    });
    if (!got.ok || got.value.length === 0) {
      failed += batch.length;
      continue;
    }
    const byFrame = new Map<number, RgbFrame>(got.value.map((image) => [image.frame, image]));
    for (const { overlay, moments } of batch) {
      const whole = byFrame.get(moments[2]!);
      if (!whole) {
        failed += 1;
        continue;
      }
      const sheet = composeSheet({
        whole,
        region: regionOf(overlay, whole.width, whole.height),
        moments: moments.map((at) => byFrame.get(at)),
      });
      const path = join(GRAPHIC_SHEETS.dir, `${overlay.id}.png`);
      try {
        await writeFile(join(ctx.dir, path), encodePng(sheet));
      } catch {
        failed += 1;
        continue;
      }
      const lead = leads[overlay.id];
      sheets.push({ overlayId: overlay.id, path, frames: moments, ...(lead ? { lead } : {}) });
    }
  }
  return ok({ sheets, warnings: failed > 0 ? [`graphic_sheets_failed: ${failed}`] : [] });
}
