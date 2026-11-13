// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * soundClean (EAR1-A2): no clicks, clipping or DC offset in the render's sound, from audio's model-free audit
 * (earshot's `sfx check`, heard through core's SoundListener). The audit was made for single effects, so only the
 * findings that mean a damaged mix count (QA_THRESHOLDS.sound.clean.kinds): its edge, tail and shape findings
 * describe a sound's design, and the render's own `silence` check covers silence. A click inside a sound effect the
 * timeline placed (a UI click is one on purpose) is not counted. Each finding carries its time in ms.
 */
import type { QaCheckResult, SoundAuditKind, SoundAuditReport } from '@taalcut/core';
import { RationalTime } from '@taalcut/core';
import type { FrameSpan } from '../../plan/types';
import { agentFix, autoFix, checkResult, type QaFinding } from '../result';
import { QA_THRESHOLDS } from '../thresholds.v1';

export interface SoundCleanInput {
  readonly audit: SoundAuditReport;
  /** Where the timeline's sound effects play (render frames). */
  readonly effects: readonly FrameSpan[];
  /** Render frames per second. */
  readonly fps: number;
  readonly durationMs?: number;
}

export function soundCleanCheck(input: SoundCleanInput): QaCheckResult {
  const { kinds, effectMarginMs } = QA_THRESHOLDS.sound.clean;
  const counted: readonly SoundAuditKind[] = kinds;
  const insideEffect = (ms: number) =>
    input.effects.some(
      (span) =>
        ms >= (span.start / input.fps) * 1000 - effectMarginMs &&
        ms <= (span.end / input.fps) * 1000 + effectMarginMs,
    );
  const found = input.audit.findings.flatMap((finding) => {
    if (finding.severity !== 'warning' || !counted.includes(finding.kind)) return [];
    const ms = finding.at ? RationalTime.toSeconds(finding.at) * 1000 : null;
    if (finding.kind === 'click' && ms !== null && insideEffect(ms)) return [];
    return [{ kind: finding.kind, ms }];
  });
  const findings: QaFinding[] = found.map(({ kind, ms }) => {
    const frame = ms === null ? null : Math.max(0, Math.floor((ms / 1000) * input.fps));
    return {
      ...(frame !== null ? { frames: { start: frame, end: frame + 1 } } : {}),
      target: { kind: 'audio', id: kind },
      ...(ms !== null ? { measured: { value: Math.round(ms), unit: 'ms' as const } } : {}),
    };
  });
  const clipped = found.some((f) => f.kind === 'clipping');
  const firstClick = found.find((f) => f.kind === 'click');
  return checkResult(
    'soundClean',
    found.length === 0 ? 'pass' : 'fail',
    {
      measured: { value: found.length, unit: 'count' },
      threshold: { max: 0, unit: 'count' },
      findings,
      fixes: [
        // A clipped mix is renormalised (gain and the true-peak limiter); a click is an edit to find.
        ...(clipped ? [autoFix('renormaliseAudio')] : []),
        ...(firstClick ? [agentFix('qa.fixes.findClick', { atMs: Math.round(firstClick.ms ?? 0) })] : []),
      ],
    },
    input.durationMs ?? 0,
  );
}
