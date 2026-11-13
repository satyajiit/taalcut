// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where a Style's logo and watermark sit on a canvas (P3-V10, SPEC P3.5): pure geometry the brand layer draws
 * and QA's brandAssets check reads, so the check measures exactly what was drawn. Corners are inside the
 * preset's safe rect; the logo is `scale` of the canvas width wide, the watermark a tenth.
 */
import type { Rect, Style } from '@taalcut/core';
import type { FrameSpan, PlannedBumpers } from '../plan/types';

/** The most a watermark may show (SPEC P3.5). */
export const WATERMARK_MAX_OPACITY = 0.6;
/** A logo watermark's width as a share of the canvas width; a text watermark's cap height of the height. */
const WATERMARK_WIDTH_SHARE = 0.1;
export const WATERMARK_TEXT_SHARE = 0.018;

type Corner = NonNullable<Style['logo']>['placement'];

export interface BrandPiece {
  readonly kind: 'logo' | 'watermark';
  /** The image's sha256, or null for a text watermark. */
  readonly asset: string | null;
  readonly text: string | null;
  readonly rect: Rect;
  readonly opacity: number;
  readonly spans: readonly FrameSpan[];
}

export function cornerRect(corner: Corner, width: number, height: number, safe: Rect): Rect {
  const left = corner === 'topLeft' || corner === 'bottomLeft';
  const top = corner === 'topLeft' || corner === 'topRight';
  return {
    x: left ? safe.x : safe.x + safe.width - width,
    y: top ? safe.y : safe.y + safe.height - height,
    width,
    height,
  };
}

/** Logo and watermark boxes for a render of `durationFrames` with these bumpers. */
export function brandLayout(
  style: Style,
  canvas: { readonly width: number; readonly height: number; readonly safe: Rect },
  bumpers: PlannedBumpers,
  durationFrames: number,
): BrandPiece[] {
  const pieces: BrandPiece[] = [];
  const whole = [{ start: 0, end: durationFrames }];
  const logo = style.logo;
  if (logo) {
    const width = Math.round(logo.scale * canvas.width);
    const height = Math.round((width * logo.height) / logo.width);
    const spans =
      logo.showOn === 'always'
        ? whole
        : [bumpers.intro, bumpers.outro].filter((span): span is FrameSpan => span !== null);
    if (spans.length > 0)
      pieces.push({
        kind: 'logo',
        asset: logo.asset,
        text: null,
        rect: cornerRect(logo.placement, width, height, canvas.safe),
        opacity: logo.opacity,
        spans,
      });
  }
  const watermark = style.watermark;
  if (watermark?.kind === 'logo' && logo) {
    const width = Math.round(WATERMARK_WIDTH_SHARE * canvas.width);
    const height = Math.round((width * logo.height) / logo.width);
    pieces.push({
      kind: 'watermark',
      asset: logo.asset,
      text: null,
      rect: cornerRect(watermark.placement, width, height, canvas.safe),
      opacity: watermark.opacity,
      spans: whole,
    });
  }
  if (watermark?.kind === 'text') {
    // An estimate of the line's box: QA reads it; the browser lays the glyphs inside it.
    const height = Math.round(WATERMARK_TEXT_SHARE * canvas.height * 1.6);
    const width = Math.min(canvas.safe.width, Math.round(watermark.text.length * height * 0.45));
    pieces.push({
      kind: 'watermark',
      asset: null,
      text: watermark.text,
      rect: cornerRect(watermark.placement, width, height, canvas.safe),
      opacity: watermark.opacity,
      spans: whole,
    });
  }
  return pieces;
}
