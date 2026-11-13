// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The breakdown's overlay design step (BRK1-GFX, contract §3): for each kept overlay, its design read from the
 * reel's own frames (overlay-look/): a chat bubble, a pill, a label and so on, with its colours, corners, tail, type,
 * entrance, exit and typing. It reads the frames well inside the overlay's time for its look and the frames round
 * its edges for its motion, an overlay at a time, so memory stays one overlay's frames. Text that may be part of the
 * scene is left for the review to keep or drop, and goes unread. Without the media's pixels, or for an overlay it
 * can't read, the overlay stays plain text (no design), as before BRK1. Pixels alone decide: a vision model is
 * worth asking only where they can't tell (a sticker's tilt, a typeface's class), which the review shows as a
 * lower confidence. HFW1: an entrance is judged over the frames round the shape's appearance, read again when the
 * first read lacked them, and one they can't tell is `unknown`, apart from a cut.
 */
import { ok, RationalTime, type AsyncResult, type TextOverlay } from '@taalcut/core';
import {
  AROUND_ENTRANCE,
  AROUND_EXIT,
  crop,
  edgeFramesFor,
  grow,
  readDesignAndLead,
  type PixelRect,
  type RegionImage,
  type RgbFrame,
} from '../overlay-look';
import type { StepContext } from './steps';

export const OVERLAY_DESIGN_READ = {
  /** The longest overlays are read first, at most this many (each costs one decode of its frames). */
  maxOverlays: 24,
  /** Shorter overlays (frames) are flashes, not designed overlays: unread. */
  minFrames: 8,
  /** Frames well inside the overlay that make its settled look. */
  settledFrames: 5,
  /** How far before the words a shape may come on (typing), in frames, and read at every frame this close. */
  leadFrames: 30,
  closeFrames: 12,
  /** Further back than `closeFrames`, every this many frames. */
  leadStep: 3,
  /** The analysis copy's own width: nothing is gained by asking more. */
  maxDimension: 720,
  /**
   * HFW1: reads after the first that fetch the frames round the overlay's appearance it lacked (a shape that came on
   * between the sparse early frames, or before them), so its entrance is judged over them, never one frame.
   */
  edgePasses: 2,
} as const;

const range = (from: number, to: number, step = 1) =>
  Array.from({ length: Math.max(0, Math.floor((to - from) / step) + 1) }, (_, index) => from + index * step);

/** The frames read for an overlay on [start, end): its settled ones, and those round its edges. */
export function framesFor(start: number, end: number, total: number) {
  const { settledFrames, leadFrames, closeFrames, leadStep } = OVERLAY_DESIGN_READ;
  const inner = { from: Math.min(end - 1, start + 2), to: Math.max(start, end - 3) };
  const settled = [
    ...new Set(
      range(0, settledFrames - 1).map((index) =>
        Math.round(inner.from + ((inner.to - inner.from) * index) / Math.max(1, settledFrames - 1)),
      ),
    ),
  ];
  // The words' own appearance and end are judged from these; one earlier is read again round it (readOverlayDesigns).
  const edges = [
    ...range(start - leadFrames, start - closeFrames - 1, leadStep),
    ...range(start - closeFrames, start + AROUND_ENTRANCE.after),
    ...range(end - AROUND_EXIT.before, end - 1 + AROUND_EXIT.after),
  ];
  const clamp = (frames: number[]) =>
    [...new Set(frames.filter((frame) => frame >= 0 && frame < total))].sort((a, b) => a - b);
  return { settled: clamp(settled), edges: clamp(edges) };
}

/** The words' box and the region read round it, in frame pixels. */
function regionsFor(box: TextOverlay['box'], width: number, height: number) {
  const words: PixelRect = {
    left: Math.max(0, Math.floor(box.x * width)),
    top: Math.max(0, Math.floor(box.y * height)),
    right: Math.min(width, Math.ceil((box.x + box.width) * width)),
    bottom: Math.min(height, Math.ceil((box.y + box.height) * height)),
  };
  const textHeight = Math.max(1, words.bottom - words.top);
  const region = grow(
    words,
    { x: Math.max((words.right - words.left) * 0.9, textHeight * 5), y: textHeight * 2.5 },
    { left: 0, top: 0, right: width, bottom: height },
  );
  return {
    region,
    words: {
      left: words.left - region.left,
      top: words.top - region.top,
      right: words.right - region.left,
      bottom: words.bottom - region.top,
    },
  };
}

/** The read frames in order, as the edges the reader judges motion from. */
const edgesOf = (byFrame: ReadonlyMap<number, RegionImage>) =>
  [...byFrame.entries()].sort(([a], [b]) => a - b).map(([frame, image]) => ({ frame, image }));

const sceneDoubt = (overlay: TextOverlay) =>
  overlay.doubts?.some((doubt) => doubt.reason === 'textMaybeScene');

/**
 * The overlays with their designs read; the ones it couldn't read are unchanged. `leads`: for each designed overlay,
 * the frames its shape showed before its words (DSG1-READ: how long a typing indicator ran).
 */
export async function readOverlayDesigns(
  ctx: StepContext,
  overlays: readonly TextOverlay[],
): AsyncResult<{ overlays: TextOverlay[]; warnings: string[]; leads: Record<string, number> }> {
  const pixels = ctx.analysers.media.framePixels;
  if (!pixels || overlays.length === 0) return ok({ overlays: [...overlays], warnings: [], leads: {} });
  const frameOf = (time: RationalTime) => RationalTime.toFrames(time, ctx.rate, 'round');
  const wanted = overlays
    .filter((overlay) => !sceneDoubt(overlay) && overlay.box.width > 0 && overlay.box.height > 0)
    .filter((overlay) => frameOf(overlay.duration) >= OVERLAY_DESIGN_READ.minFrames)
    .sort((a, b) => b.duration.value - a.duration.value)
    .slice(0, OVERLAY_DESIGN_READ.maxOverlays);
  const designs = new Map<string, NonNullable<TextOverlay['design']>>();
  const leads: Record<string, number> = {};
  let failed = 0;
  for (const overlay of wanted) {
    if (ctx.signal.aborted) break;
    const start = frameOf(overlay.start);
    const end = start + frameOf(overlay.duration);
    const frames = framesFor(start, end, ctx.total);
    const options = { rate: ctx.rate, maxDimension: OVERLAY_DESIGN_READ.maxDimension, signal: ctx.signal };
    const got = await pixels(
      ctx.path,
      [...new Set([...frames.settled, ...frames.edges])].sort((a, b) => a - b),
      options,
    );
    const first = got.ok ? got.value[0] : undefined;
    if (!got.ok || !first) {
      failed++;
      continue;
    }
    const { region, words } = regionsFor(overlay.box, first.width, first.height);
    const byFrame = new Map(got.value.map((image: RgbFrame) => [image.frame, crop(image, region)]));
    const settled = frames.settled.flatMap((frame) => byFrame.get(frame) ?? []);
    const readNow = () =>
      readDesignAndLead({
        width: first.width,
        height: first.height,
        region,
        words,
        start,
        end,
        settled,
        edges: { frames: edgesOf(byFrame) },
      });
    let read = readNow();
    // HFW1: the frames round where it came on that the first read lacked, then judged again.
    for (let pass = 0; read && pass < OVERLAY_DESIGN_READ.edgePasses; pass++) {
      // At first back by a sparse step too: a shape first seen on a sparse frame may have come on in the gap before.
      const back = read.first - (pass === 0 ? OVERLAY_DESIGN_READ.leadStep : 0);
      const missing = [
        ...new Set([...edgeFramesFor(back, end, ctx.total), ...edgeFramesFor(read.first, end, ctx.total)]),
      ]
        .filter((frame) => !byFrame.has(frame))
        .sort((a, b) => a - b);
      if (missing.length === 0 || ctx.signal.aborted) break;
      const more = await pixels(ctx.path, missing, options);
      if (!more.ok) break;
      for (const image of more.value) byFrame.set(image.frame, crop(image, region));
      read = readNow();
    }
    if (read) {
      designs.set(overlay.id, read.design);
      leads[overlay.id] = read.lead;
    }
  }
  return ok({
    overlays: overlays.map((overlay) => {
      const design = designs.get(overlay.id);
      if (!design) return overlay;
      // A filled shape is a box behind the words, which a text item can show too.
      const background = design.colors.fill ? 'box' : overlay.appearance.background;
      return { ...overlay, design, appearance: { ...overlay.appearance, background } };
    }),
    warnings: failed > 0 ? [`overlay_design_failed: ${failed}`] : [],
    leads,
  });
}
