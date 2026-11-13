// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Caption and text checks (docs/qa-gate.md). Boxes come from the DOM probe
 * (Chrome's own shaping of the real font, the authoritative measurement);
 * glyph coverage is checked before rendering from the fonts' cmaps.
 */
import {
  CAPTION_COMMANDS,
  FrameRate,
  TIMELINE_COMMANDS,
  type CaptionTrack,
  type QaCheckResult,
  type QaFix,
  type Rect,
} from '@taalcut/core';
import type { CaptionFontId, ProbedTextBox, ProbedWord, QaPlan } from '../../types';
import { planCaptionFix, planOverflowFix } from '../fixes';
import { agentFix, checkResult, commandFix, skipped, type QaFinding, type QaTarget } from '../result';
import { planTextMove } from '../text-move';
import { QA_THRESHOLDS } from '../thresholds.v1';
import { uniqueFixes } from './video';

export type { QaTarget } from '../result';

/** The captions module's coverage check (src/captions/glyphs.ts). */
export type GlyphChecker = (
  cues: readonly { readonly id: string; readonly text: string }[],
  font: CaptionFontId,
) => readonly { readonly cueId: string; readonly codepoints: readonly number[] }[];

export interface CaptionCheckInput {
  readonly plan: QaPlan;
  readonly captions: CaptionTrack | null;
  readonly boxes: readonly ProbedTextBox[];
  readonly safe: Rect;
  readonly target: QaTarget;
}

const setStyle = (target: QaTarget, style: object, labelKey: string): QaFix =>
  commandFix(labelKey, CAPTION_COMMANDS.setStyle, { ...target, style });
const rebuild = (target: QaTarget): QaFix =>
  commandFix('qa.fixes.rebuildCaptions', CAPTION_COMMANDS.rebuild, { ...target });

const finding = (box: ProbedTextBox, value: number, unit: 'px' | 'count' = 'px'): QaFinding => ({
  frames: { start: box.frame, end: box.frame + 1 },
  target: { kind: box.kind === 'caption' ? 'caption' : 'text', id: box.id },
  measured: { value, unit },
});

/** Pixels a box sits outside `rect` (0 when inside, with tolerance). */
export function outsideBy(box: Rect, rect: Rect, tolerance: number): number {
  return Math.max(
    0,
    rect.x - tolerance - box.x,
    rect.y - tolerance - box.y,
    box.x + box.width - (rect.x + rect.width + tolerance),
    box.y + box.height - (rect.y + rect.height + tolerance),
  );
}

const hasText = (input: CaptionCheckInput) => input.plan.cues.length > 0 || input.plan.texts.length > 0;

/**
 * A text item outside the safe rect: a ready timeline.moveText to the nearest box that passes (FIX-QA), planned on
 * every box the probe measured for it. Without the item's own box (a plan refitted to another canvas), the Editor's
 * judgment call as before.
 */
function moveTextFix(input: CaptionCheckInput, textId: string): QaFix {
  const text = input.plan.texts.find((entry) => entry.id === textId);
  if (!text?.box) return agentFix('qa.fixes.moveText', { textId });
  const box = planTextMove({
    box: text.box,
    align: text.align ?? 'center',
    probed: input.boxes.filter((entry) => entry.kind === 'text' && entry.id === textId).map((entry) => entry.box),
    safe: input.safe,
    canvas: { width: input.plan.width, height: input.plan.height },
  });
  return commandFix('qa.fixes.moveText', TIMELINE_COMMANDS.moveText, { ...input.target, itemId: textId, box });
}

export function captionSafeZoneCheck(input: CaptionCheckInput): QaCheckResult {
  if (!hasText(input)) return skipped('captionSafeZone');
  const tolerance = QA_THRESHOLDS.captions.safeTolerancePx;
  const failing = input.boxes.filter((box) => outsideBy(box.box, input.safe, tolerance) > 0);
  const worst = Math.max(0, ...input.boxes.map((box) => outsideBy(box.box, input.safe, tolerance)));
  const fixes: QaFix[] = [];
  const captionBoxes = failing.filter((box) => box.kind === 'caption');
  if (captionBoxes.length > 0 && input.captions) {
    const patch = planCaptionFix({ boxes: captionBoxes, style: input.captions.style, safe: input.safe, canvasHeight: input.plan.height });
    if (Object.keys(patch).length > 0) fixes.push(setStyle(input.target, patch, 'qa.fixes.moveCaptions'));
  }
  for (const id of new Set(failing.filter((entry) => entry.kind === 'text').map((entry) => entry.id)))
    fixes.push(moveTextFix(input, id));
  return checkResult(
    'captionSafeZone',
    failing.length > 0 ? 'fail' : 'pass',
    {
      measured: { value: worst, unit: 'px' },
      threshold: { max: 0, unit: 'px' },
      findings: failing.map((box) => finding(box, outsideBy(box.box, input.safe, tolerance))),
      fixes: uniqueFixes(fixes),
    },
    0,
  );
}

/** How far two boxes run into each other: the smaller of the two overlaps (0 or less when they are clear). */
const overlapDepth = (a: Rect, b: Rect) =>
  Math.min(
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  );

/**
 * How deep a scaled (popping) word runs into another word of its cue, pixels; 0 when every one is clear. Words
 * at rest are never compared with each other: plain text sits as the layout put it.
 */
export function wordCollision(words: readonly ProbedWord[]): number {
  let worst = 0;
  words.forEach((word, index) => {
    if (Math.abs(word.scale - 1) < 1e-3) return;
    words.forEach((other, otherIndex) => {
      if (otherIndex !== index) worst = Math.max(worst, overlapDepth(word.box, other.box));
    });
  });
  return worst;
}

/** A popped word runs into another word of the cue (the pop's room is missing or too small). */
const collides = (box: ProbedTextBox) =>
  wordCollision(box.words ?? []) > QA_THRESHOLDS.captions.wordOverlapTolerancePx;

export function captionOverflowCheck(input: CaptionCheckInput): QaCheckResult {
  if (!hasText(input)) return skipped('captionOverflow');
  const canvas = { x: 0, y: 0, width: input.plan.width, height: input.plan.height };
  const maxLines = input.captions?.style.maxLines ?? Infinity;
  const failing = input.boxes.filter(
    (box) =>
      box.overflow ||
      outsideBy(box.box, canvas, 0) > 0 ||
      (box.kind === 'caption' && (box.lines > maxLines || collides(box))),
  );
  const fixes: QaFix[] = [];
  const captionBoxes = failing.filter((box) => box.kind === 'caption');
  if (captionBoxes.length > 0 && input.captions) {
    const patch = planOverflowFix(captionBoxes, input.captions.style);
    if (Object.keys(patch).length > 0) fixes.push(setStyle(input.target, patch, 'qa.fixes.shrinkCaptions'));
    fixes.push(rebuild(input.target));
  }
  for (const box of failing.filter((entry) => entry.kind === 'text'))
    fixes.push(agentFix('qa.fixes.shortenText', { textId: box.id }));
  return checkResult(
    'captionOverflow',
    failing.length > 0 ? 'fail' : 'pass',
    {
      measured: { value: Math.max(0, ...input.boxes.filter((box) => box.kind === 'caption').map((box) => box.lines)), unit: 'count' },
      threshold: { max: Number.isFinite(maxLines) ? maxLines : 3, unit: 'count' },
      findings: failing.map((box) =>
        collides(box) ? finding(box, Math.ceil(wordCollision(box.words ?? []))) : finding(box, box.lines, 'count'),
      ),
      fixes: uniqueFixes(fixes),
    },
    0,
  );
}

/** Fonts to offer when the style's font misses glyphs, tried in this order. */
const COVERING_FONTS: readonly CaptionFontId[] = ['notoSans', 'notoSansDevanagari', 'mukta', 'hind', 'baloo2', 'poppins'];

/** Cue texts as the captions module checks them: the words of the cue joined by spaces. */
export function cueTexts(captions: CaptionTrack): { id: string; text: string }[] {
  return captions.cues.map((cue) => ({ id: cue.id, text: cue.words.map((word) => word.text).join(' ') }));
}

/** Before rendering: every grapheme's code points in the style's font stack. After: document.fonts.check per cue. */
export function captionGlyphsCheck(
  input: Pick<CaptionCheckInput, 'captions' | 'target'> & { readonly boxes?: readonly ProbedTextBox[] },
  glyphIssues: GlyphChecker,
): QaCheckResult {
  const captions = input.captions;
  if (!captions || captions.cues.length === 0) return skipped('captionGlyphs');
  const cues = cueTexts(captions);
  const issues = glyphIssues(cues, captions.style.font);
  const unready = (input.boxes ?? []).filter((box) => box.kind === 'caption' && !box.fontsReady);
  const findings: QaFinding[] = [
    ...issues.map((issue) => ({
      target: { kind: 'caption' as const, id: issue.cueId },
      measured: { value: issue.codepoints.length, unit: 'count' as const },
    })),
    ...unready.map((box) => finding(box, 1, 'count')),
  ];
  const fixes: QaFix[] = [];
  if (issues.length > 0) {
    const failingCues = cues.filter((cue) => issues.some((issue) => issue.cueId === cue.id));
    const font = COVERING_FONTS.find((candidate) => candidate !== captions.style.font && glyphIssues(failingCues, candidate).length === 0);
    if (font) fixes.push(setStyle(input.target, { font }, 'qa.fixes.coveringFont'));
    // No curated font covers it (Tamil, Arabic): the text itself has to change.
    else for (const issue of issues.slice(0, 4)) fixes.push(agentFix('qa.fixes.editCaptionText', { cueId: issue.cueId }));
  }
  return checkResult(
    'captionGlyphs',
    findings.length > 0 ? 'fail' : 'pass',
    { measured: { value: findings.length, unit: 'count' }, threshold: { max: 0, unit: 'count' }, findings, fixes },
    0,
  );
}

/** WCAG 2 relative luminance of '#rrggbb'. */
export function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** `background`: the mean colour under each cue's box with the text hidden, by cue id (from the engine). */
export function captionReadabilityCheck(
  input: Pick<CaptionCheckInput, 'plan' | 'captions' | 'target'>,
  background: ReadonlyMap<string, string>,
): QaCheckResult {
  const captions = input.captions;
  if (!captions || input.plan.cues.length === 0) return skipped('captionReadability');
  const { minSeconds, minSizePx, minContrast, minStrokePx, minBackgroundOpacity } = QA_THRESHOLDS.captions;
  const rate = FrameRate.of(input.plan.rateNum, input.plan.rateDen);
  const minFrames = Math.ceil((minSeconds * rate.num) / rate.den);
  const findings: QaFinding[] = [];
  const fixes: QaFix[] = [];
  let hard = false;
  const short = input.plan.cues.filter((cue) => cue.span.end - cue.span.start < minFrames);
  for (const cue of short)
    findings.push({ frames: cue.span, target: { kind: 'caption', id: cue.id }, measured: { value: cue.span.end - cue.span.start, unit: 'frames' } });
  if (short.length > 0) {
    hard = true;
    fixes.push(rebuild(input.target));
  }
  const style = captions.style;
  if (style.sizePx < minSizePx) {
    hard = true;
    findings.push({ target: { kind: 'caption', id: 'style' }, measured: { value: style.sizePx, unit: 'px' } });
    fixes.push(setStyle(input.target, { sizePx: minSizePx }, 'qa.fixes.largerCaptions'));
  }
  const protectedText =
    (style.stroke?.widthPx ?? 0) >= minStrokePx || (style.background?.opacity ?? 0) >= minBackgroundOpacity;
  let lowest = Infinity;
  if (!protectedText) {
    for (const cue of input.plan.cues) {
      const under = background.get(cue.id);
      if (!under) continue;
      const ratio = contrastRatio(style.textColor, under);
      lowest = Math.min(lowest, ratio);
      if (ratio < minContrast)
        findings.push({ frames: cue.span, target: { kind: 'caption', id: cue.id }, measured: { value: Math.round(ratio * 100) / 100, unit: 'ratio' } });
    }
    if (lowest < minContrast)
      fixes.push(setStyle(input.target, { stroke: { color: '#000000', widthPx: 4 } }, 'qa.fixes.captionStroke'));
  }
  const status = hard ? 'fail' : findings.length > 0 ? 'warn' : 'pass';
  return checkResult(
    'captionReadability',
    status,
    {
      measured: { value: Number.isFinite(lowest) ? Math.round(lowest * 100) / 100 : minContrast, unit: 'ratio' },
      threshold: { min: minContrast, unit: 'ratio' },
      findings,
      fixes: uniqueFixes(fixes),
    },
    0,
  );
}
