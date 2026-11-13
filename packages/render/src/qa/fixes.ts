// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What to do about failing checks (SPEC section 10): `planQaFixes` sorts a
 * report's fixes into the ones the render process applies itself and the
 * ones the Reviewer and the Editor (or the QA card's buttons) apply;
 * `planCaptionFix` turns caption boxes that left the safe rect into a ready
 * `captions.setStyle` payload: move first, then shrink, then fewer words.
 */
import type { CaptionStyle, QaCheckId, QaFix, QaReport, Rect } from '@taalcut/core';
import type { ProbedTextBox } from '../types';
import { QA_THRESHOLDS } from './thresholds.v1';

export interface PlannedQaFixes {
  /** Applied in the render process, then their checks run again on the same render. */
  readonly auto: readonly { readonly action: Extract<QaFix, { kind: 'auto' }>['action']; readonly checks: readonly QaCheckId[] }[];
  /** Ready commands: the QA card's buttons and the Editor dispatch them as they are. */
  readonly commands: readonly { readonly check: QaCheckId; readonly fix: Extract<QaFix, { kind: 'command' }> }[];
  /** Judgment calls for the Reviewer. */
  readonly agent: readonly { readonly check: QaCheckId; readonly fix: Extract<QaFix, { kind: 'agent' }> }[];
}

/** The fixes of every failing (and, for agent and command fixes, warning) check, grouped by who applies them. */
export function planQaFixes(report: QaReport): PlannedQaFixes {
  const auto = new Map<string, QaCheckId[]>();
  const commands: { check: QaCheckId; fix: Extract<QaFix, { kind: 'command' }> }[] = [];
  const agent: { check: QaCheckId; fix: Extract<QaFix, { kind: 'agent' }> }[] = [];
  for (const check of report.checks) {
    if (check.status !== 'fail' && check.status !== 'warn') continue;
    for (const fix of check.fixes) {
      // A warning never blocks, so it never costs an automatic re-render.
      if (fix.kind === 'auto' && check.status === 'fail') auto.set(fix.action, [...(auto.get(fix.action) ?? []), check.id]);
      else if (fix.kind === 'command') commands.push({ check: check.id, fix });
      else if (fix.kind === 'agent') agent.push({ check: check.id, fix });
    }
  }
  // Cheapest first: audio, then a remux, a re-encode, a fresh render.
  const order = ['renormaliseAudio', 'remux', 'reencode', 'rerender'];
  return {
    auto: [...auto.entries()]
      .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
      .map(([action, checks]) => ({ action: action as PlannedQaFixes['auto'][number]['action'], checks })),
    commands,
    agent,
  };
}

export type CaptionStylePatch = Partial<Pick<CaptionStyle, 'anchorY' | 'sizePx' | 'maxWords' | 'maxLines'>>;

export interface CaptionFixInput {
  /** The failing caption boxes, canvas pixels. */
  readonly boxes: readonly Pick<ProbedTextBox, 'box' | 'lines'>[];
  readonly style: Pick<CaptionStyle, 'anchorY' | 'sizePx' | 'maxWords' | 'maxLines'>;
  readonly safe: Rect;
  /** Canvas height, 1920. */
  readonly canvasHeight: number;
}

/** Room left between a moved block and the safe rect's edge. */
const MARGIN = 4;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

function shrunk(style: CaptionFixInput['style'], factor: number): CaptionStylePatch {
  const { minSizePx } = QA_THRESHOLDS.captions;
  const sizePx = Math.max(minSizePx, Math.floor(style.sizePx * factor));
  // Even the smallest size doesn't fit: fewer words per cue as well.
  const fewerWords = style.sizePx * factor < minSizePx && style.maxWords > 1;
  return {
    ...(sizePx < style.sizePx ? { sizePx } : {}),
    ...(fewerWords ? { maxWords: Math.max(1, Math.floor(style.maxWords / 2)) } : {}),
  };
}

/** A captions.setStyle patch that brings every box inside the safe rect, or {} when nothing helps. */
export function planCaptionFix(input: CaptionFixInput): CaptionStylePatch {
  const { boxes, style, safe, canvasHeight } = input;
  if (boxes.length === 0) return {};
  const height = Math.max(...boxes.map((entry) => entry.box.height));
  const width = Math.max(...boxes.map((entry) => entry.box.width));
  const room = safe.height - 2 * MARGIN;
  // Too wide for the safe width: only a smaller size helps (the block is centred across the safe width).
  if (width > safe.width) return shrunk(style, safe.width / width);
  if (height <= room) {
    const centre = style.anchorY * canvasHeight;
    const lowest = safe.y + MARGIN + height / 2;
    const highest = safe.y + safe.height - MARGIN - height / 2;
    const moved = Math.min(Math.max(centre, lowest), highest);
    const anchorY = round3(moved / canvasHeight);
    if (anchorY !== round3(style.anchorY)) return { anchorY };
    // The centre already fits but a box is still out (the probe saw a taller block): shrink a step.
    return shrunk(style, 0.9);
  }
  // Doesn't fit anywhere: shrink until it does, centred in the safe rect.
  const factor = room / height;
  return { ...shrunk(style, factor), anchorY: round3((safe.y + safe.height / 2) / canvasHeight) };
}

/** A patch for cues with more lines than allowed or text past the box. */
export function planOverflowFix(
  boxes: readonly Pick<ProbedTextBox, 'lines' | 'overflow'>[],
  style: CaptionFixInput['style'],
): CaptionStylePatch {
  const lines = Math.max(1, ...boxes.map((entry) => entry.lines));
  const factor = lines > style.maxLines ? style.maxLines / lines : 0.85;
  const patch = shrunk(style, factor);
  if (patch.sizePx === undefined && patch.maxWords === undefined && style.maxWords > 1)
    return { maxWords: Math.max(1, style.maxWords - 2) };
  return patch;
}
