// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A made video's text items as the solver's items (FRM1-OVL): each one's footprint at a scale (the reel's size kept
 * in pixels, as fit-layout.ts sizes it, shrinking toward QA's readable minimum), the reel's relation (the design's
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
import { fitBox, fitTextSize, MADE_SAFE_AREAS } from '../fit-layout';
import { inflate, toPixels, toShares, type Rect, type Size } from './geometry';
import { zoneOf } from './relation';
import { longestWordPx, textChrome, textFootprint } from './text-size';
import type { PlacementItem } from './types';

type Text = Extract<TextTrackItem, { type: 'text' }>;

/** QA's readable minimum: a cap height of 36 px at 1080 on the shorter side (render's graphicsReadability). */
const MIN_CAP_PX = 36;
/** A text item's lines and chrome reach a little past its box (fit-layout.ts textMargin): kept clear too. */
const TEXT_HALO = 4;
/** Render keeps graphics this far inside the safe rect (graphics-layer.ts MARGIN, design pixels). */
const GRAPHIC_MARGIN = 16;

export interface Owned {
  readonly item: TextTrackItem;
  readonly request: PlacementItem;
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

/** The reel's box on the made canvas: same centre share, same pixels, inside the safe area (fit-layout.ts). */
function reelBox(overlay: TextOverlay, surface: Surface): Rect {
  const { canvas, template } = surface;
  return toPixels(fitBox(overlay.design?.shape ?? overlay.box, template.canvas, canvas), canvas);
}

function textOwned(item: Text, overlay: TextOverlay, surface: Surface): Owned {
  const { canvas, template } = surface;
  const turned = orientationOf(template.canvas) !== orientationOf(canvas);
  const naturalSize = turned
    ? fitTextSize(overlay.appearance.size, template.canvas, canvas)
    : overlay.appearance.size;
  const reel = reelBox(overlay, surface);
  const safe = safeFor('text', canvas);
  const naturalWidth = Math.min(reel.width, safe.width - 2 * TEXT_HALO);
  const minSize = (MIN_CAP_PX * designScale(canvas)) / canvas.height;
  const chrome = textChrome(item.appearance.background);
  const at = (scale: number) => {
    const size = Math.max(Math.min(naturalSize, minSize), naturalSize * scale);
    // Never narrower than its longest word (capped at the safe area): no word breaks letter by letter.
    const word = Math.min(longestWordPx(item.text, size, canvas), safe.width - 2 * TEXT_HALO);
    return { size, width: Math.max(1, Math.round(naturalWidth * scale), word) };
  };
  const footprintAt = (scale: number): Size => {
    const { size, width } = at(scale);
    const drawn = textFootprint(item.text, { ...item.appearance, size }, width, canvas);
    return { width: drawn.width + 2 * TEXT_HALO, height: drawn.height + 2 * TEXT_HALO };
  };
  const request: PlacementItem = {
    id: item.id,
    span: { start: item.start.value, end: item.start.value + item.duration.value },
    sizeAt: footprintAt,
    minScale: naturalSize <= minSize ? 1 : Math.max(0.5, minSize / naturalSize),
    relation: relationOf(overlay, template),
    reel: { ...reel, width: footprintAt(1).width, height: footprintAt(1).height },
    onPicture: item.appearance.background !== 'box',
  };
  return {
    item,
    request,
    apply: (footprint, scale, reason) => {
      const { size, width } = at(scale);
      const lines = footprint.height - 2 * TEXT_HALO - 2 * chrome.y;
      const box = {
        x: footprint.x + TEXT_HALO,
        y: footprint.y + TEXT_HALO,
        width,
        height: Math.max(1, lines),
      };
      return {
        ...item,
        box: toShares(box, canvas),
        appearance: { ...item.appearance, size },
        placement: { reason },
      };
    },
  };
}

/** The item as the solver's, or null when it isn't one the solver places (no reel overlay, or a graphic). */
export function ownedItem(item: TextTrackItem, surface: Surface): Owned | null {
  if (item.type === 'graphic') return null;
  const overlay = overlayOf(item, surface.template);
  return overlay ? textOwned(item, overlay, surface) : null;
}

/** What an item not being placed covers while it is on: its box (a text item's with its reach), pixels. */
export function footprintOf(item: TextTrackItem, canvas: Size): Rect | null {
  if (item.type === 'text') return inflate(toPixels(item.box, canvas), TEXT_HALO + 16);
  return typeof item.placement === 'object' ? toPixels(item.placement.box, canvas) : null;
}
