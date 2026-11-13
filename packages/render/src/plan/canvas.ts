// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A plan on the export preset's canvas (SPEC P3.2 "Landscape and 4:3 output", P3.11). A timeline is made on
 * its own canvas (portrait 1080×1920); the landscape presets render it on 1920×1080 or 1440×1080 without
 * changing the timeline: text boxes keep their place as fractions of the safe rect, fonts scale with the
 * canvas height, and captions move to the preset's anchor. On the timeline's own canvas the plan is
 * returned unchanged, so every Phase 2 composition keeps its bytes.
 */
import type { Box, CaptionStyle, CaptionTrack, ExportPreset, Rect, Result, Timeline } from '@taalcut/core';
import { ok } from '@taalcut/core';
import { planTimeline } from './render-plan';
import type { PlannedText, RenderPlan } from './types';

/** Core's caption size floor (captionStyleSchema), which a scaled style keeps. */
const MIN_CAPTION_PX = 44;

export interface Canvas {
  readonly width: number;
  readonly height: number;
}

export const sameCanvas = (a: Canvas, b: Canvas): boolean => a.width === b.width && a.height === b.height;

/** A box (fractions of the timeline canvas) placed at the same fractions of the output's safe rect. */
export function boxIntoSafe(box: Box, safe: Rect, output: Canvas): Box {
  return {
    x: (safe.x + box.x * safe.width) / output.width,
    y: (safe.y + box.y * safe.height) / output.height,
    width: (box.width * safe.width) / output.width,
    height: (box.height * safe.height) / output.height,
  };
}

/** A caption style drawn on another canvas: sizes scale with the height, the block sits at the preset's anchor. */
export function captionStyleForCanvas(style: CaptionStyle, from: Canvas, preset: ExportPreset): CaptionStyle {
  if (sameCanvas(from, preset)) return style;
  const ratio = preset.height / from.height;
  const px = (value: number, min: number) => Math.max(min, Math.round(value * ratio));
  return {
    ...style,
    sizePx: px(style.sizePx, MIN_CAPTION_PX),
    stroke: style.stroke ? { ...style.stroke, widthPx: px(style.stroke.widthPx, 1) } : null,
    background: style.background
      ? {
          ...style.background,
          paddingPx: px(style.background.paddingPx, 0),
          radiusPx: px(style.background.radiusPx, 0),
        }
      : null,
    anchorY: preset.captionAnchorY,
  };
}

function captionsFor(track: CaptionTrack | null, from: Canvas, preset: ExportPreset): CaptionTrack | null {
  return track ? { ...track, style: captionStyleForCanvas(track.style, from, preset) } : null;
}

/**
 * The plan on the preset's canvas. Text items' `sizeRatio` is a cap-height share of the canvas height, so it
 * already scales with the height and stays as it is.
 */
export function adaptPlan(plan: RenderPlan, preset: ExportPreset): RenderPlan {
  if (sameCanvas(plan, preset)) return plan;
  const texts: PlannedText[] = plan.texts.map((text) => ({
    ...text,
    box: boxIntoSafe(text.box, preset.safe, preset),
    refitted: true as const,
  }));
  return {
    ...plan,
    width: preset.width,
    height: preset.height,
    texts,
    captions: captionsFor(plan.captions, plan, preset),
  };
}

/** planTimeline on the preset's canvas. */
export function planForPreset(timeline: Timeline, preset: ExportPreset): Result<RenderPlan> {
  const planned = planTimeline(timeline);
  return planned.ok ? ok(adaptPlan(planned.value, preset)) : planned;
}
