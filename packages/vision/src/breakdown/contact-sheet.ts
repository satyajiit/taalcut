// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Contact sheets (P2-T4): one low-resolution JPEG of frames, with the layout
 * that maps each tile back to its frame. Two uses: the breakdown's kept
 * sheet (one tile per shot, its middle frame, 4 columns, 180 px tiles,
 * ≤ 600 KB) and the contact strip `vision.confirmCuts` shows a vision model
 * (one row per disputed candidate: frames −2..+2 at 256 px).
 */
import {
  ok,
  type AsyncResult,
  type ContactSheetAnnotationOptions,
  type FrameRate,
  type TileAnnotation,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { VISION_CONFIG } from '../config';
import { fitLongSide, probeSource, sampleFrames, type VideoSource } from '../media/frames';
import { composeGrid, encodeJpeg } from '../media/sheet';
import { plainTime, type RationalTimePlain } from './types';

export interface SheetDeps {
  readonly media: MediaContext;
  /** Where the short-lived raw frame file goes. */
  readonly tempDir: string;
}

export interface SheetTile {
  readonly tile: number;
  readonly frame: number;
  readonly at: RationalTimePlain;
  /** For strips: the candidate (row) this tile belongs to. */
  readonly row?: number;
}

export interface ContactSheet {
  readonly jpeg: Buffer;
  readonly width: number;
  readonly height: number;
  readonly columns: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly layout: readonly SheetTile[];
}

export type SheetLayout =
  /** One tile per frame, in order. */
  | { readonly kind: 'frames'; readonly frames: readonly number[] }
  /** One tile per shot (its middle frame); `cuts` are the first frames of shots 2…n. */
  | { readonly kind: 'shots'; readonly cuts: readonly number[] }
  /** One row per candidate: frames at `strip.offsets` around it. */
  | { readonly kind: 'strips'; readonly candidates: readonly number[] };

export interface SheetOptions {
  readonly columns?: number;
  readonly tileLongSide?: number;
  readonly maxBytes?: number;
  readonly annotate?: boolean | ContactSheetAnnotationOptions;
  readonly signal?: AbortSignal;
}

const SHEET = VISION_CONFIG.breakdown.sheet;

function formatClock(frame: number, rate: FrameRate): string {
  const seconds = Math.max(0, (frame * rate.den) / Math.max(1, rate.num));
  const mins = Math.floor(seconds / 60);
  const rem = seconds - mins * 60;
  const whole = Math.floor(rem);
  const tenths = Math.min(9, Math.floor((rem - whole) * 10));
  return `${String(mins).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${tenths}`;
}

/** Builds Set-of-Mark tile annotations for a contact sheet or strip layout. */
export function tileAnnotationsFor(
  plan: readonly { readonly frame: number; readonly row?: number }[],
  layoutKind: SheetLayout['kind'],
  rate: FrameRate,
  annotate?: boolean | ContactSheetAnnotationOptions,
): readonly TileAnnotation[] | undefined {
  if (!annotate) return undefined;
  const opts: ContactSheetAnnotationOptions =
    typeof annotate === 'boolean' ? { badges: annotate } : annotate;
  const safeBoxes = opts.safeZone ? [{ kind: 'safeZone' as const, ...opts.safeZone }] : [];
  const offsets = VISION_CONFIG.strip.offsets;
  return plan.map((item, index): TileAnnotation => {
    if (layoutKind === 'strips') {
      const offset = offsets[index % offsets.length] ?? 0;
      const sign = offset > 0 ? `+${offset}` : String(offset);
      const isCandidate = offset === 0;
      return {
        ...(opts.badges ? { badge: `R${(item.row ?? 0) + 1} ${sign}F` } : {}),
        ...(isCandidate && opts.badges ? { cornerTag: 'CUT?' } : {}),
        highlight: isCandidate,
        boxes: safeBoxes,
      };
    }
    return {
      ...(opts.badges ? { badge: `#${index + 1} · ${formatClock(item.frame, rate)}` } : {}),
      highlight: false,
      boxes: safeBoxes,
    };
  });
}

export async function buildContactSheet(
  path: string,
  deps: SheetDeps,
  layout: SheetLayout,
  options: SheetOptions = {},
): AsyncResult<ContactSheet> {
  const probed = await probeSource(deps.media, path, options.signal);
  if (!probed.ok) return probed;
  const source = probed.value;
  const plan = tilesOf(layout, source);
  const strips = layout.kind === 'strips';
  const columns = strips
    ? VISION_CONFIG.strip.offsets.length
    : Math.max(1, Math.min(options.columns ?? SHEET.columns, plan.length || 1));
  const longSide = options.tileLongSide ?? (strips ? VISION_CONFIG.strip.tileLongSide : SHEET.tileLongSide);
  const size = fitLongSide(source.width, source.height, longSide);
  const sampled = await sampleFrames(deps.media, source, {
    size,
    format: 'rgb24',
    frames: plan.map((t) => t.frame),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!sampled.ok) return sampled;
  const byIndex = new Map(sampled.value.map((frame) => [frame.index, frame]));
  const annotations = tileAnnotationsFor(plan, layout.kind, source.rate, options.annotate);
  const image = composeGrid(
    plan.map((t) => byIndex.get(t.frame) ?? null),
    columns,
    size,
    annotations,
    deps.media,
  );
  const encoded = await encodeJpeg(deps.media, image, {
    tempDir: deps.tempDir,
    maxBytes: options.maxBytes ?? SHEET.maxBytes,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!encoded.ok) return encoded;
  return ok({
    jpeg: encoded.value.jpeg,
    width: image.width,
    height: image.height,
    columns,
    tileWidth: size.width,
    tileHeight: size.height,
    layout: plan.map((t, tile) => ({
      tile,
      frame: t.frame,
      at: plainTime(t.frame, source.rate),
      ...(t.row === undefined ? {} : { row: t.row }),
    })),
  });
}

/** The frames to tile, clamped to the source, at most `sheet.maxTiles` (strips: `strip.perSheet` rows). */
export function tilesOf(
  layout: SheetLayout,
  source: Pick<VideoSource, 'frameCount'>,
): { frame: number; row?: number }[] {
  const last = Math.max(0, (source.frameCount ?? 1) - 1);
  const clamp = (f: number) => Math.min(last, Math.max(0, Math.round(f)));
  if (layout.kind === 'frames')
    return layout.frames.slice(0, SHEET.maxTiles).map((f) => ({ frame: clamp(f) }));
  if (layout.kind === 'strips') {
    return layout.candidates
      .slice(0, VISION_CONFIG.strip.perSheet)
      .flatMap((c, row) => VISION_CONFIG.strip.offsets.map((offset) => ({ frame: clamp(c + offset), row })));
  }
  const bounds = [0, ...[...layout.cuts].filter((c) => c > 0 && c <= last).sort((a, b) => a - b), last + 1];
  const tiles: { frame: number }[] = [];
  for (let i = 0; i + 1 < bounds.length && tiles.length < SHEET.maxTiles; i++) {
    const from = bounds[i] as number;
    const to = bounds[i + 1] as number;
    if (to > from) tiles.push({ frame: clamp(Math.floor((from + to - 1) / 2)) });
  }
  return tiles;
}
