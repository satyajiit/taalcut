// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LYR1, in the breakdown job: one picture of a sequence for the vision model that reads it after the job
 * (sequence-read.ts). Each cell shows the sequence's place, with room round it, at the middle of one piece's time:
 * the pieces the text engine read and the ones it could not, in order, numbered from 1. A word the engine cannot
 * read over a boarding pass is plain to a model that sees the whole place; and where the engine read a word's case
 * or a letter wrong, the model sees that too. A PNG in the experiment, gone with it; never fails the breakdown.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { boxSchema, RationalTime, type Box, type TextOverlay } from '@taalcut/core';
import { z } from 'zod';
import type { PixelRect, RgbFrame } from '../overlay-look';
import { canvas, draw, encodePng, type Canvas } from '../overlay-look/sheet';
import type { StepContext } from './steps';
import { zonePlace } from './text-zone-place';

export const SEQUENCE_SHEETS = {
  /** Pieces shown per sequence, from its first: one model call reads them all. */
  maxCells: 24,
  columns: 3,
  cellWidth: 312,
  gap: 8,
  /** The band above each cell that holds its number. */
  label: 26,
  /** The analysis copy's own width. */
  maxDimension: 720,
  dir: 'sequences',
} as const;

const frame = z.int().nonnegative();
export const draftSequenceSheetSchema = z.object({
  /** Experiment-relative PNG. */
  path: z.string().min(1).max(512),
  /** The cells in order: the overlay each shows and the frame it is shown at. */
  cells: z
    .array(z.object({ overlayId: z.string().min(1).max(64), frame }))
    .min(1)
    .max(SEQUENCE_SHEETS.maxCells),
});
export type DraftSequenceSheet = z.output<typeof draftSequenceSheetSchema>;

const overlayId = z.string().min(1).max(64);
/**
 * LYR1: text that replaces itself in place, a word or a line at a time (text-sequence.ts), as the draft keeps it. It
 * is here, beside its sheet's schema, so this file and text-judge.ts (which re-exports it) import one way only.
 */
export const draftTextSequenceSchema = z.object({
  /** Its kept overlays, in the order they show. */
  overlayIds: z.array(overlayId).min(1).max(200),
  /** Where its words show, and its frames [start, end). */
  zone: boxSchema,
  start: frame,
  end: frame,
  /** Those of its overlays no frame could read (text-zone.ts): kept without words until a reader states them. */
  unread: z.array(overlayId).max(200),
  /** Its pieces in one picture, for the model that reads them after the job. */
  sheet: draftSequenceSheetSchema.optional(),
});
export type DraftTextSequence = z.output<typeof draftTextSequenceSchema>;

/** Digits as 3 by 5 dots, drawn four pixels a dot: the cells' numbers, with no font to ship. */
const DIGITS = [
  '111101101101111',
  '010110010010111',
  '111001111100111',
  '111001111001111',
  '101101111001001',
  '111100111001111',
  '111100111101111',
  '111001001001001',
  '111101111101111',
  '111101111001111',
] as const;
const DOT = 4;

function drawNumber(target: Canvas, value: number, left: number, top: number): void {
  [...String(value)].forEach((digit, place) => {
    const dots = DIGITS[Number(digit)]!;
    for (let dot = 0; dot < 15; dot++) {
      if (dots[dot] !== '1') continue;
      const x = left + place * DOT * 4 + (dot % 3) * DOT;
      const y = top + Math.floor(dot / 3) * DOT;
      for (let dy = 0; dy < DOT; dy++)
        for (let dx = 0; dx < DOT; dx++) {
          if (x + dx >= target.width || y + dy >= target.height) continue;
          target.rgb.set([255, 255, 255], ((y + dy) * target.width + x + dx) * 3);
        }
    }
  });
}

/** The sheet's pixels: each cell `rect` of its frame, numbered from 1, row by row. */
export function composeSequenceSheet(
  cells: readonly { readonly image: RgbFrame; readonly rect: PixelRect }[],
): Canvas {
  const { columns, cellWidth, gap, label } = SEQUENCE_SHEETS;
  const first = cells[0]!.rect;
  const cellHeight = Math.max(
    1,
    Math.round((cellWidth * (first.bottom - first.top)) / Math.max(1, first.right - first.left)),
  );
  const rows = Math.ceil(cells.length / columns);
  const out = canvas(
    columns * cellWidth + (columns - 1) * gap,
    rows * (label + cellHeight) + (rows - 1) * gap,
  );
  cells.forEach(({ image, rect }, at) => {
    const left = (at % columns) * (cellWidth + gap);
    const top = Math.floor(at / columns) * (label + cellHeight + gap);
    drawNumber(out, at + 1, left + 4, top + 3);
    draw(out, image, rect, {
      left,
      top: top + label,
      right: left + cellWidth,
      bottom: top + label + cellHeight,
    });
  });
  return out;
}

/** The sequence's place in frame pixels: where its pieces show, with the room the second read gave them. */
export function sequenceRect(boxes: readonly Box[], width: number, height: number): PixelRect {
  const { region } = zonePlace(boxes);
  const left = Math.max(0, Math.floor(region.x * width));
  const top = Math.max(0, Math.floor(region.y * height));
  return {
    left,
    top,
    right: Math.min(width, Math.max(left + 1, Math.ceil((region.x + region.width) * width))),
    bottom: Math.min(height, Math.max(top + 1, Math.ceil((region.y + region.height) * height))),
  };
}

/**
 * A sheet for each sequence, in the draft's order: the sequences come back with theirs set. None without the media's
 * pixels; a sheet that could not be made is a warning and the sequence stays without one.
 */
export async function makeSequenceSheets(
  ctx: StepContext,
  sequences: readonly DraftTextSequence[],
  overlays: readonly TextOverlay[],
): Promise<{ sequences: DraftTextSequence[]; warnings: string[] }> {
  const pixels = ctx.analysers.media.framePixels;
  if (!pixels || sequences.length === 0) return { sequences: [...sequences], warnings: [] };
  const byId = new Map(overlays.map((overlay) => [overlay.id as string, overlay]));
  const out: DraftTextSequence[] = [];
  let failed = 0;
  for (const [number, sequence] of sequences.entries()) {
    const pieces = sequence.overlayIds
      .flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
      .slice(0, SEQUENCE_SHEETS.maxCells);
    const cells = pieces.map((overlay) => {
      const start = RationalTime.toFrames(overlay.start, ctx.rate, 'round');
      const length = Math.max(1, RationalTime.toFrames(overlay.duration, ctx.rate, 'round'));
      return { overlayId: overlay.id as string, frame: Math.min(ctx.total - 1, start + (length >> 1)) };
    });
    const got =
      cells.length === 0 || ctx.signal.aborted
        ? null
        : await pixels(
            ctx.path,
            [...new Set(cells.map((cell) => cell.frame))].sort((a, b) => a - b),
            {
              rate: ctx.rate,
              maxDimension: SEQUENCE_SHEETS.maxDimension,
              signal: ctx.signal,
            },
          );
    const images = new Map((got?.ok ? got.value : []).map((image) => [image.frame, image]));
    const shown = cells.filter((cell) => images.has(cell.frame));
    if (shown.length !== cells.length || shown.length === 0) {
      failed += 1;
      out.push(sequence);
      continue;
    }
    const one = images.get(shown[0]!.frame)!;
    const rect = sequenceRect(
      pieces.map((overlay) => overlay.box),
      one.width,
      one.height,
    );
    const path = join(SEQUENCE_SHEETS.dir, `${number + 1}.png`);
    try {
      await mkdir(join(ctx.dir, SEQUENCE_SHEETS.dir), { recursive: true });
      const sheet = composeSequenceSheet(shown.map((cell) => ({ image: images.get(cell.frame)!, rect })));
      await writeFile(join(ctx.dir, path), encodePng(sheet));
      out.push({ ...sequence, sheet: { path, cells: shown } });
    } catch {
      failed += 1;
      out.push(sequence);
    }
  }
  return { sequences: out, warnings: failed > 0 ? [`sequence_sheets_failed: ${failed}`] : [] };
}
