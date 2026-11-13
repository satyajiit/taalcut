// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Motion graphics checks (SPEC P3.10, HFW1): each composition graphic measured where it is settled after its
 * entrance and in its middle (graphicMoments, the make's fill checks' moments), by what it draws in the export's own
 * page (the DOM probe's composition boxes, engine/dom-probe.ts): inside the safe rect (graphicsSafeZone), clear of
 * captions and other graphics at the same frame (graphicsOverlap), and on long enough with its smallest words at the
 * type floor by cap height (graphicsReadability). Pure. A composition places and sizes itself, so a failure's fix
 * is the Designer's: an agent fix the Editor turns into graphics.design for that graphic. Only a graphic on too
 * short gets a ready command, graphics.edit of its length.
 */
import {
  fromMilliseconds,
  GRAPHICS_COMMANDS,
  overlapArea,
  type FrameRate,
  type QaCheckResult,
  type QaFix,
  type Rect,
} from '@taalcut/core';
import { CAPTION_FONT_FILES, fontMetrics, type FontKey } from '../../captions/fonts';
import type { FrameSpan } from '../../plan/types';
import type { ProbedTextBox, QaGraphic } from '../../types';
import { agentFix, checkResult, commandFix, skipped, type QaFinding, type QaTarget } from '../result';
import { outsideBy } from './captions';

/** Thresholds (SPEC P3.10), versioned with the checks. */
export const GRAPHICS_THRESHOLDS = {
  version: 1,
  /** A probed box may stray this far past the safe rect (rounding of transforms). */
  safeTolerancePx: 2,
  /** Boxes may touch by this much before they overlap. */
  overlapTolerancePx: 1,
  minOnScreenSeconds: 1.0,
  minItemSeconds: 0.6,
  /** Cap height at 1080 on the canvas's shorter side. */
  minCapHeightPx: 36,
  /** WCAG contrast for large text; below it only warns. */
  minContrast: 3,
} as const;

/** The cap height share when the smallest words' font isn't one of Taalcut's (the curated fonts sit near it). */
const CAP_HEIGHT = 0.7;

/** What a graphic draws at one moment. */
export interface GraphicMeasure {
  readonly fullCanvas?: boolean;
  /** The render frame it was measured at. */
  readonly frame: number;
  /** Its drawn content, canvas pixels; null when nothing of it shows. */
  readonly box: Rect | null;
  /** Its smallest words' size, canvas pixels (absent: no words). */
  readonly minFontPx?: number;
  /** Cap height as a share of the size, for the font of its smallest words. */
  readonly capShare: number;
}

export interface GraphicsCheckInput {
  readonly graphics: readonly QaGraphic[];
  /** Each graphic's measures at its moments, by id. */
  readonly measures: ReadonlyMap<string, readonly GraphicMeasure[]>;
  /** What else the probe read at those frames: captions and the other graphics. */
  readonly boxes: readonly ProbedTextBox[];
  readonly safe: Rect;
  readonly canvas: { readonly width: number; readonly height: number };
  readonly rate: FrameRate;
  readonly target: QaTarget;
}

/** Where a graphic is measured: settled after its entrance (half a second in, or a quarter), and its middle. */
export function graphicMoments(span: FrameSpan, rate: FrameRate): number[] {
  const length = span.end - span.start;
  if (length <= 0) return [];
  const half = Math.round((0.5 * rate.num) / rate.den);
  return [
    ...new Set([span.start + Math.min(half, Math.floor(length / 4)), span.start + Math.floor(length / 2)]),
  ];
}

/** Authored chapters also sample late motion and the handoff to the next beat. */
export function graphicProbeMoments(graphic: QaGraphic, rate: FrameRate): number[] {
  const base = graphicMoments(graphic.span, rate);
  if (!graphic.programItemId) return base;
  const length = graphic.span.end - graphic.span.start;
  return [
    ...new Set([
      ...base,
      graphic.span.start + Math.floor(length / 4),
      graphic.span.start + Math.floor((length * 3) / 4),
      graphic.span.end - Math.max(1, Math.min(Math.floor(length / 8), Math.round(rate.num / rate.den / 4))),
    ]),
  ].sort((a, b) => a - b);
}

/** The cap height share of the first Taalcut font a CSS font-family names. */
export function capShareOf(family: string | undefined): number {
  for (const name of (family ?? '').split(',')) {
    const bare = name.trim().replace(/^["']|["']$/g, '');
    const file = CAPTION_FONT_FILES.find((entry) => entry.family === bare);
    if (file) return fontMetrics(file.fontId as FontKey).capHeight;
  }
  return CAP_HEIGHT;
}

const drawn = (input: GraphicsCheckInput, id: string) =>
  (input.measures.get(id) ?? []).filter(
    (measure): measure is GraphicMeasure & { box: Rect } => measure.box !== null,
  );

const finding = (id: string, frame: number, value: number, unit: 'px' | 'count' | 'seconds'): QaFinding => ({
  frames: { start: frame, end: frame + 1 },
  target: { kind: 'text', id },
  measured: { value, unit },
});

/** The Designer's fix for a graphic: the Editor asks graphics.design for a new design of it. */
const designFix = (key: string, itemId: string, params: Record<string, number> = {}): QaFix =>
  agentFix(key, { itemId, ...params });

export function graphicsSafeZoneCheck(input: GraphicsCheckInput): QaCheckResult {
  if (input.graphics.length === 0) return skipped('graphicsSafeZone');
  const tolerance = GRAPHICS_THRESHOLDS.safeTolerancePx;
  const findings: QaFinding[] = [];
  const failing = new Set<string>();
  let worst = 0;
  for (const graphic of input.graphics) {
    const boxes = drawn(input, graphic.id);
    // Nothing drawn where it should be settled: off the canvas or never on, never a pass.
    if (boxes.length === 0) {
      failing.add(graphic.id);
      findings.push({ frames: { ...graphic.span }, target: { kind: 'text', id: graphic.id } });
    }
    for (const measure of boxes) {
      const safe = measure.fullCanvas ? { x: 0, y: 0, ...input.canvas } : input.safe;
      const outside = outsideBy(measure.box, safe, tolerance);
      worst = Math.max(worst, outside);
      if (outside <= 0) continue;
      failing.add(graphic.id);
      findings.push(finding(graphic.id, measure.frame, Math.round(outside), 'px'));
    }
  }
  return checkResult(
    'graphicsSafeZone',
    failing.size > 0 ? 'fail' : 'pass',
    {
      measured: { value: Math.round(worst), unit: 'px' },
      threshold: { max: 0, unit: 'px' },
      findings,
      fixes: [...failing].map((id) => designFix('qa.fixes.moveGraphic', id)),
    },
    0,
  );
}

export function graphicsOverlapCheck(input: GraphicsCheckInput): QaCheckResult {
  if (input.graphics.length === 0) return skipped('graphicsOverlap');
  const tolerance = GRAPHICS_THRESHOLDS.overlapTolerancePx;
  const findings: QaFinding[] = [];
  const failing = new Set<string>();
  for (const graphic of input.graphics)
    for (const measure of drawn(input, graphic.id)) {
      if (measure.fullCanvas) continue;
      const crossed = input.boxes.filter(
        (other) =>
          other.frame === measure.frame &&
          (!other.program || other.textBounds !== undefined) &&
          (other.kind === 'caption' ||
            (other.kind === 'graphic' && other.id !== graphic.id && other.id !== graphic.programItemId)) &&
          overlapArea(measure.box, other.textBounds ?? other.box, tolerance) > 0,
      );
      if (crossed.length === 0) continue;
      failing.add(graphic.id);
      findings.push(finding(graphic.id, measure.frame, crossed.length, 'count'));
    }
  return checkResult(
    'graphicsOverlap',
    failing.size > 0 ? 'fail' : 'pass',
    {
      measured: { value: failing.size, unit: 'count' },
      threshold: { max: 0, unit: 'count' },
      findings,
      fixes: [...failing].map((id) => designFix('qa.fixes.moveGraphic', id)),
    },
    0,
  );
}

export function graphicsReadabilityCheck(input: GraphicsCheckInput): QaCheckResult {
  if (input.graphics.length === 0) return skipped('graphicsReadability');
  const fps = input.rate.num / input.rate.den;
  const minCap =
    (GRAPHICS_THRESHOLDS.minCapHeightPx * Math.min(input.canvas.width, input.canvas.height)) / 1080;
  const findings: QaFinding[] = [];
  const fixes: QaFix[] = [];
  let smallest = Infinity;
  for (const graphic of input.graphics) {
    const seconds = (graphic.span.end - graphic.span.start) / fps;
    if (seconds < GRAPHICS_THRESHOLDS.minOnScreenSeconds) {
      findings.push({
        frames: { ...graphic.span },
        target: { kind: 'text', id: graphic.id },
        measured: { value: Math.round(seconds * 100) / 100, unit: 'seconds' },
      });
      const durationMs = Math.min(15_000, Math.ceil(GRAPHICS_THRESHOLDS.minOnScreenSeconds * 10) * 100 + 200);
      if (graphic.programItemId) fixes.push(designFix('qa.fixes.lengthenGraphic', graphic.programItemId));
      else
        fixes.push(
          commandFix('qa.fixes.lengthenGraphic', GRAPHICS_COMMANDS.edit, {
            ...input.target,
            itemId: graphic.id,
            duration: fromMilliseconds(durationMs),
          }),
        );
    }
    let small = false;
    for (const measure of drawn(input, graphic.id)) {
      if (measure.minFontPx === undefined) continue;
      const cap = measure.minFontPx * measure.capShare;
      smallest = Math.min(smallest, cap);
      if (cap + 0.01 >= minCap) continue;
      small = true;
      findings.push(finding(graphic.id, measure.frame, Math.round(cap), 'px'));
    }
    if (small)
      fixes.push(designFix('qa.fixes.largerGraphicWords', graphic.id, { minCapPx: Math.round(minCap) }));
  }
  return checkResult(
    'graphicsReadability',
    findings.length > 0 ? 'fail' : 'pass',
    {
      ...(Number.isFinite(smallest)
        ? { measured: { value: Math.round(smallest), unit: 'px' as const } }
        : {}),
      threshold: { min: Math.round(minCap), unit: 'px' },
      findings,
      fixes,
    },
    0,
  );
}
