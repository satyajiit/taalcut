// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A made video's text items as the solver's items (FRM1-OVL): each one's footprint at a scale (the reel's size kept
 * in pixels, as fit-layout.ts sizes it, shrinking toward QA's readable minimum; TXT1: its words on one line for each
 * written line, so the reel's box never wraps them, text-size.ts `fitWords`), the reel's relation (the design's
 * `placement`, else read from the reel's subjects, else the reel box's band), the reel's box on the made canvas, and
 * how to write the chosen box back. HFW1 retire: a graphic is a composition that lays itself out where the reel's
 * shape sat, so the solver keeps clear of it and never places it. Pure.
 */
import {
  type OverlayPlacement,
  type PlacementReason,
  type Template,
  type TextOverlay,
  type TextTrackItem,
} from '@taalcut/core';
import { relationIn } from '@taalcut/templates';
import { orientationOf } from '../../casting/slots';
import { fitTextSize, MADE_SAFE_AREAS, reelBoxOn } from '../fit-layout';
import { inflate, toPixels, toShares, type Rect, type Size } from './geometry';
import { zoneOf } from './relation';
import { fitWords, textChrome } from './text-size';
import type { PlacementItem } from './types';

type Text = Extract<TextTrackItem, { type: 'text' }>;

/** QA's readable minimum: a cap height of 36 px at 1080 on the shorter side (render's graphicsReadability). */
const MIN_CAP_PX = 36;
/** A text item's lines and chrome reach a little past its box (fit-layout.ts textMargin): kept clear too. */
export const TEXT_HALO = 4;
/** Render keeps graphics this far inside the safe rect (graphics-layer.ts MARGIN, design pixels). */
const GRAPHIC_MARGIN = 16;

export interface Owned {
  readonly item: TextTrackItem;
  readonly request: PlacementItem;
  /** The reel's own box of its words on the made canvas, pixels (TXT1: a run reads how its texts lined up). */
  readonly reelBox: Rect;
  /** The item with the solver's footprint box, scale and reason. */
  apply(box: Rect, scale: number, reason: PlacementReason): TextTrackItem;
}

export interface Surface {
  readonly canvas: Size;
  readonly template: Template;
}

const designScale = (canvas: Size) => Math.min(canvas.width, canvas.height) / 1080;

/** Where items may sit on the made canvas, pixels: graphics a margin inside it, as render lays them out. */
export function safeFor(kind: 'text' | 'graphic', canvas: Size): Rect {
  const safe = toPixels(MADE_SAFE_AREAS[orientationOf(canvas)], canvas);
  return inflate(safe, -(kind === 'graphic' ? GRAPHIC_MARGIN * designScale(canvas) : TEXT_HALO));
}

const overlayOf = (item: TextTrackItem, template: Template): TextOverlay | undefined => {
  const id = item.type === 'text' ? item.overlayId : item.overlay?.id;
  return id ? template.text.find((overlay) => overlay.id === id) : undefined;
};

/** The reel's intent for an overlay: recorded, read from the reel's subjects, or its band of the reel's frame. */
export function relationOf(overlay: TextOverlay, template: Template): OverlayPlacement {
  const recorded = overlay.design?.placement ?? relationIn(overlay, template.subjects, template.canvas);
  if (recorded) return recorded;
  return {
    relativeTo: 'frame',
    zone: zoneOf(overlay.design?.shape ?? overlay.box, { x: 0, y: 0, width: 1, height: 1 }),
  };
}

/** The reel's box on the made canvas: same centre share, same pixels, where the reel had it (fit-layout.ts). */
function reelBox(overlay: TextOverlay, surface: Surface): Rect {
  const { canvas, template } = surface;
  return toPixels(reelBoxOn(overlay.design?.shape ?? overlay.box, template.canvas, canvas), canvas);
}

/** The reel's own size of an overlay's words on the made canvas: the capitals' height over the frame's. */
export function reelTextSize(overlay: TextOverlay, surface: Surface): number {
  const { canvas, template } = surface;
  return orientationOf(template.canvas) !== orientationOf(canvas)
    ? fitTextSize(overlay.appearance.size, template.canvas, canvas)
    : overlay.appearance.size;
}

/** `size`: the size the text is given (TXT1: a run's one size); default the reel's own for this overlay. */
function textOwned(item: Text, overlay: TextOverlay, surface: Surface, size?: number): Owned {
  const { canvas } = surface;
  const naturalSize = size ?? reelTextSize(overlay, surface);
  const reel = reelBox(overlay, surface);
  const minSize = (MIN_CAP_PX * designScale(canvas)) / canvas.height;
  const chrome = textChrome(item.appearance.background);
  // TXT1: the box follows the words. The reel's box says where they sat, never where they wrap: one line for each
  // written line at the size given (a line wider than the frame wraps at the frame's width).
  const at = (scale: number) => {
    const size = Math.max(Math.min(naturalSize, minSize), naturalSize * scale);
    return { size, words: fitWords(item.text, size, canvas) };
  };
  const footprintAt = (scale: number): Size => {
    const { words } = at(scale);
    return {
      width: words.width + 2 * chrome.x + 2 * TEXT_HALO,
      height: words.height + 2 * chrome.y + 2 * TEXT_HALO,
    };
  };
  // TXT1: the words keep the reel's anchor, not its top left: a centred line stays centred on the reel's centre
  // when its box is wider here (a longer word, another size), a left or right line keeps its edge. The owner's
  // centred lyric drifted right word by word, each box growing from the reel's left edge.
  const full = footprintAt(1);
  const { align } = item.appearance;
  const anchored: Rect = {
    x:
      align === 'left'
        ? reel.x - TEXT_HALO
        : align === 'right'
          ? reel.x + reel.width + TEXT_HALO - full.width
          : reel.x + (reel.width - full.width) / 2,
    y: reel.y + (reel.height - full.height) / 2,
    width: full.width,
    height: full.height,
  };
  const request: PlacementItem = {
    id: item.id,
    span: { start: item.start.value, end: item.start.value + item.duration.value },
    sizeAt: footprintAt,
    minScale: naturalSize <= minSize ? 1 : Math.max(0.5, minSize / naturalSize),
    relation: relationOf(overlay, surface.template),
    reel: anchored,
    onPicture: item.appearance.background !== 'box',
  };
  return {
    item,
    request,
    reelBox: reel,
    apply: (footprint, scale, reason) => {
      const { size, words } = at(scale);
      const box = {
        x: footprint.x + TEXT_HALO,
        y: footprint.y + TEXT_HALO,
        width: words.width,
        height: Math.max(1, footprint.height - 2 * TEXT_HALO - 2 * chrome.y),
      };
      // A box is stored inside the frame: one that reaches past an edge moves the least that brings it in.
      const inside = {
        ...box,
        x: Math.min(Math.max(0, box.x), Math.max(0, canvas.width - box.width)),
        y: Math.min(Math.max(0, box.y), Math.max(0, canvas.height - box.height)),
      };
      return {
        ...item,
        box: toShares(inside, canvas),
        appearance: { ...item.appearance, size },
        breaks: 'written',
        placement: { reason },
      };
    },
  };
}

/** The item as the solver's, or null when it isn't one the solver places (no reel overlay, or a graphic). */
export function ownedItem(item: TextTrackItem, surface: Surface, size?: number): Owned | null {
  if (item.type === 'graphic') return null;
  const overlay = overlayOf(item, surface.template);
  return overlay ? textOwned(item, overlay, surface, size) : null;
}

/** The overlay a text item was made from, when the template still has it. */
export const overlayFor = (item: TextTrackItem, template: Template): TextOverlay | undefined =>
  overlayOf(item, template);

/** What an item not being placed covers while it is on: its box (a text item's with its reach), pixels. */
export function footprintOf(item: TextTrackItem, canvas: Size): Rect | null {
  if (item.type === 'text') return inflate(toPixels(item.box, canvas), TEXT_HALO + 16);
  return typeof item.placement === 'object' ? toPixels(item.placement.box, canvas) : null;
}
