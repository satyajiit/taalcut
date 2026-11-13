// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The checks that run before rendering (docs/qa-gate.md, rule 6): cheap
 * failures never cost a render. Their results go into the render's report,
 * so a render stopped at preflight still has its QA card.
 */
import type { CaptionTrack, ExportPreset, QaCheckResult } from '@taalcut/core';
import { captionGlyphIssues } from '../captions/glyphs';
import type { QaPlan } from '../types';
import { captionGlyphsCheck, type GlyphChecker, type QaTarget } from './checks/captions';
import { durationPreflight } from './checks/format';
import {
  preflightFontsCheck,
  preflightMediaCheck,
  rightsReferenceAudioCheck,
  type FontCheckItem,
  type PreflightMediaInput,
} from './checks/preflight';
import { orderChecks } from './verdict';

export interface PreflightInput {
  readonly plan: QaPlan;
  readonly preset: ExportPreset;
  readonly target: QaTarget;
  readonly captions: CaptionTrack | null;
  readonly media: PreflightMediaInput;
  /** Every font file the composition links, with its locked sha256. */
  readonly fonts: readonly FontCheckItem[];
  /** The cmap coverage check; captionGlyphIssues unless a test swaps it. */
  readonly glyphIssues?: GlyphChecker;
}

export async function runPreflight(input: PreflightInput): Promise<QaCheckResult[]> {
  const started = performance.now();
  const results = [
    await preflightMediaCheck(input.media),
    await preflightFontsCheck(input.fonts),
    await rightsReferenceAudioCheck({
      music: input.plan.audio.music,
      referenceAudio: input.plan.audio.referenceAudio,
      target: input.target,
    }),
    durationPreflight(input.plan, input.preset, input.target),
  ];
  const glyphs = captionGlyphsCheck({ captions: input.captions, target: input.target }, input.glyphIssues ?? captionGlyphIssues);
  results.push({ ...glyphs, durationMs: Math.round(performance.now() - started) });
  return orderChecks(results);
}

/** True when nothing failed: the render may start. */
export function preflightPassed(results: readonly QaCheckResult[]): boolean {
  return results.every((check) => check.status !== 'fail');
}
