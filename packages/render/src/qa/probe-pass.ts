// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * runQa's DOM probe pass: one pass over every frame the caption checks and the Phase 3 modules asked for, and
 * the caption checks that read it. Text on screen and no probe is a capture fault, never a pass.
 */
import type { QaCheckId, QaCheckResult } from '@taalcut/core';
import { captionGlyphIssues } from '../captions/glyphs';
import {
  captionGlyphsCheck,
  captionOverflowCheck,
  captionReadabilityCheck,
  captionSafeZoneCheck,
} from './checks/captions';
import type { ProbedFrames } from './modules/module';
import type { RunQaInput } from './run-qa-input';
import { unmeasured } from './unmeasured';

export interface ProbePass {
  /** What the probe read; null when it didn't run or failed. */
  readonly frames: ProbedFrames | null;
  /** Text was on screen and the probe read it (or nothing needed reading). */
  readonly probed: boolean;
}

/** One DOM probe pass over every frame the caption checks and the Phase 3 modules asked for. */
export async function probeAll(
  input: RunQaInput,
  wanted: ReadonlySet<QaCheckId>,
  moduleFrames: readonly number[],
): Promise<ProbePass> {
  const needsCaptions = ['captionSafeZone', 'captionOverflow', 'captionGlyphs', 'captionReadability'].some(
    (id) => wanted.has(id as QaCheckId),
  );
  const captionFrames = needsCaptions
    ? [
        ...input.plan.cues.flatMap((cue) => cue.probeFrames),
        ...input.plan.texts.map((text) => text.probeFrame),
      ]
    : [];
  const frames = [...new Set([...captionFrames, ...moduleFrames])].sort((a, b) => a - b);
  if (frames.length === 0) return { frames: null, probed: true };
  try {
    if (input.probeFrame) return { frames: await input.probeFrame(frames), probed: true };
    if (input.probe) return { frames: { boxes: await input.probe(frames), visuals: [] }, probed: true };
  } catch {
    // A frame the probe can't read: the checks that needed it fail as unmeasured.
  }
  return { frames: null, probed: false };
}

/** The caption checks on the probe's text boxes. */
export async function captionResults(
  input: RunQaInput,
  wanted: ReadonlySet<QaCheckId>,
  pass: ProbePass,
): Promise<QaCheckResult[]> {
  const results: QaCheckResult[] = [];
  const hasText = input.plan.cues.length > 0 || input.plan.texts.length > 0;
  const boxes = pass.frames?.boxes ?? [];
  const probed = !hasText || pass.probed;
  // Motion graphics have their own checks (P3-V13); the caption checks read captions and text items.
  const textBoxes = boxes.filter((box) => box.kind !== 'graphic');
  const base = {
    plan: input.plan,
    captions: input.captions,
    boxes: textBoxes,
    safe: input.preset.safe,
    target: input.target,
  };
  for (const id of ['captionSafeZone', 'captionOverflow'] as const) {
    if (!wanted.has(id)) continue;
    // No probe while there is text on screen: a capture fault, never a pass.
    if (!probed) results.push(unmeasured(id, 'domProbe'));
    else results.push(id === 'captionSafeZone' ? captionSafeZoneCheck(base) : captionOverflowCheck(base));
  }
  if (wanted.has('captionGlyphs'))
    results.push(
      captionGlyphsCheck(
        { captions: input.captions, target: input.target, boxes },
        input.glyphIssues ?? captionGlyphIssues,
      ),
    );
  if (wanted.has('captionReadability')) {
    const background = new Map<string, string>();
    const style = input.captions?.style;
    const unprotected = style && (style.stroke?.widthPx ?? 0) < 3 && (style.background?.opacity ?? 0) < 0.5;
    if (unprotected && input.sampleUnderBox) {
      const sample = input.sampleUnderBox;
      await Promise.all(
        input.plan.cues.map(async (cue) => {
          const middle = cue.probeFrames[0];
          const box = boxes.find((entry) => entry.kind === 'caption' && entry.id === cue.id);
          if (middle === undefined || !box) return;
          try {
            background.set(cue.id, await sample(middle, box.box));
          } catch {
            // An unreadable background leaves contrast unmeasured for this cue; it only ever warns.
          }
        }),
      );
    }
    results.push(captionReadabilityCheck(base, background));
  }
  return results;
}
