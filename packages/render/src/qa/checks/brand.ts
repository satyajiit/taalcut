// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * brandAssets (P3-V10, SPEC P3.10): the logo and watermark inside the safe rect, the watermark at most 0.6
 * opaque, the bumper assets present and the logo file on disk. Problems warn; the intro left out on path a
 * (platform sound) is a note on a passing check. Measured on the brand layout the layer drew from.
 */
import type { QaCheckResult, Rect, Style } from '@taalcut/core';
import type { PlannedBumpers } from '../../plan/types';
import { brandLayout, WATERMARK_MAX_OPACITY } from '../../style/brand-layout';
import { agentFix, checkResult, skipped, type QaFinding } from '../result';

export interface BrandCheckInput {
  readonly style: Style | null;
  readonly bumpers: PlannedBumpers;
  readonly canvas: { readonly width: number; readonly height: number; readonly safe: Rect };
  readonly durationFrames: number;
  /** Logo files that were on disk, by sha256. */
  readonly assetsPresent: ReadonlySet<string>;
}

const inside = (box: Rect, safe: Rect) =>
  box.x >= safe.x &&
  box.y >= safe.y &&
  box.x + box.width <= safe.x + safe.width &&
  box.y + box.height <= safe.y + safe.height;

const note = (id: string, measured?: QaFinding['measured']): QaFinding => ({
  target: { kind: 'file', id },
  ...(measured ? { measured } : {}),
});

export function brandAssetsCheck(input: BrandCheckInput, durationMs = 0): QaCheckResult {
  const style = input.style;
  if (!style) return skipped('brandAssets', durationMs);
  const problems: QaFinding[] = [];
  for (const piece of brandLayout(style, input.canvas, input.bumpers, input.durationFrames)) {
    if (!inside(piece.rect, input.canvas.safe)) problems.push(note(`${piece.kind}OutsideSafe`));
    if (piece.kind === 'watermark' && piece.opacity > WATERMARK_MAX_OPACITY)
      problems.push(note('watermarkOpacity', { value: piece.opacity, unit: 'ratio' }));
    if (piece.asset && !input.assetsPresent.has(piece.asset)) problems.push(note(`${piece.kind}Missing`));
  }
  for (const bumper of input.bumpers.missing) problems.push(note(`${bumper}Missing`));
  if (problems.length > 0)
    return checkResult(
      'brandAssets',
      'warn',
      { findings: problems, fixes: [agentFix('qa.fixes.replaceBrandAsset', { problems: problems.length })] },
      durationMs,
    );
  // Path a: the platform's sound starts at frame 0, so the intro was left out on purpose.
  return checkResult(
    'brandAssets',
    'pass',
    { findings: input.bumpers.introLeftOut ? [note('introLeftOut')] : [] },
    durationMs,
  );
}
