// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-OVL: each overlay's place in the reel as an intent (contract §2, `design.placement`): beside the person's
 * head it sat by (which side, how far, in which band), or a band of the frame when nobody was near. Read from the
 * reel's subjects (FRM1-SUB's `template.subjects`) over the overlay's own time: the head nearest the overlay in each
 * sample, its median place, and the overlay's side of it. Timeline's placement solver keeps the relation on the
 * made video and never covers a head. Pure; boxes are fractions of the template's canvas, distances in its pixels.
 */
import {
  reelSubjectsDuring,
  type OverlayPlacement,
  type ReelSubjects,
  type ReelSubjectSample,
  type Template,
  type TextOverlay,
} from '@taalcut/core';

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
type Size = Pick<Template['canvas'], 'width' | 'height'>;

export const OVERLAY_RELATION = {
  /** A head counts from this confidence. */
  minConfidence: 0.3,
  /** Further than this many head heights from every head, an overlay sits in the frame, not by a person. */
  besideHeads: 2.5,
  /** Heads smaller than this share of the frame's height are passers-by, not the reel's subject. */
  minHeadShare: 0.06,
} as const;

const px = (box: Box, size: Size): Box => ({
  x: box.x * size.width,
  y: box.y * size.height,
  width: box.width * size.width,
  height: box.height * size.height,
});

const cx = (box: Box) => box.x + box.width / 2;
const cy = (box: Box) => box.y + box.height / 2;

function edgeDistance(a: Box, b: Box): number {
  const dx = Math.max(0, b.x - (a.x + a.width), a.x - (b.x + b.width));
  const dy = Math.max(0, b.y - (a.y + a.height), a.y - (b.y + b.height));
  return Math.hypot(dx, dy);
}

/** Which third of the frame the box's middle sits in. */
export function zoneOfBox(box: Box): OverlayPlacement['zone'] {
  const at = cy(box);
  return at < 1 / 3 ? 'top' : at < 2 / 3 ? 'middle' : 'bottom';
}

/** Which side of the head the box is on: the axis it is furthest along, for their sizes. */
function sideOf(box: Box, head: Box): NonNullable<OverlayPlacement['side']> {
  const dx = cx(box) - cx(head);
  const dy = cy(box) - cy(head);
  const nx = dx / Math.max(1e-6, (box.width + head.width) / 2);
  const ny = dy / Math.max(1e-6, (box.height + head.height) / 2);
  if (Math.abs(nx) >= Math.abs(ny)) return dx >= 0 ? 'right' : 'left';
  return dy < 0 ? 'above' : 'below';
}

const median = (values: readonly number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

/**
 * The overlay's relation over the reel's samples during it: beside the nearest real head, or the frame's band.
 * `box` is the overlay's drawn shape (else its words), in the template canvas's fractions.
 */
export function overlayRelation(
  box: Box,
  samples: readonly ReelSubjectSample[],
  canvas: Size,
): OverlayPlacement {
  const zone = zoneOfBox(box);
  const shape = px(box, canvas);
  const nearest: Box[] = [];
  for (const sample of samples) {
    const heads = sample.heads
      .filter((head) => head.confidence >= OVERLAY_RELATION.minConfidence)
      .filter((head) => head.box.height >= OVERLAY_RELATION.minHeadShare)
      .map((head) => px(head.box, canvas));
    const closest = heads.sort((a, b) => edgeDistance(shape, a) - edgeDistance(shape, b))[0];
    if (closest) nearest.push(closest);
  }
  if (nearest.length === 0) return { relativeTo: 'frame', zone };
  const head: Box = {
    x: median(nearest.map((h) => h.x)),
    y: median(nearest.map((h) => h.y)),
    width: median(nearest.map((h) => h.width)),
    height: median(nearest.map((h) => h.height)),
  };
  const distance = edgeDistance(shape, head);
  if (distance > OVERLAY_RELATION.besideHeads * head.height) return { relativeTo: 'frame', zone };
  return {
    relativeTo: 'subject',
    side: sideOf(shape, head),
    zone,
    gap: Math.round(Math.min(10, distance / Math.max(1, head.height)) * 100) / 100,
  };
}

/** The relation of an overlay of `template`, from the reel's subjects during it; null without subjects. */
export function relationIn(
  overlay: Pick<TextOverlay, 'box' | 'design' | 'start' | 'duration'>,
  subjects: ReelSubjects | undefined,
  canvas: Size,
): OverlayPlacement | null {
  if (!subjects || subjects.samples.length === 0) return null;
  const box = overlay.design?.shape ?? overlay.box;
  return overlayRelation(box, reelSubjectsDuring(subjects, overlay.start, overlay.duration), canvas);
}

/** The designed overlays with their placement relation recorded (the others, and all without subjects, unchanged). */
export function withPlacementRelations(
  overlays: readonly TextOverlay[],
  subjects: ReelSubjects | undefined,
  canvas: Size,
): TextOverlay[] {
  return overlays.map((overlay) => {
    if (!overlay.design || overlay.design.placement) return overlay;
    // Without the reel's subjects nothing is known beyond the box, which the solver reads itself.
    const placement = relationIn(overlay, subjects, canvas);
    return placement ? { ...overlay, design: { ...overlay.design, placement } } : overlay;
  });
}

/** A built template with its designed overlays' relation to the reel's people recorded (template.subjects). */
export function withOverlayRelations(template: Template): Template {
  if (!template.subjects) return template;
  return {
    ...template,
    text: withPlacementRelations(template.text, template.subjects, template.canvas),
  };
}
