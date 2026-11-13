// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * soundCritique (EAR1-A2): earshot's sound scorecard of the render, against launch films or the template reel's
 * own sound (core's SoundCritique, heard through the SoundListener). It warns and never fails: a short-form video
 * is not a launch film, and the reference profile is the person's own choice of sound. A warning carries the
 * critique's first fixes: loudness and true peak map to render's renormalise action, a fix with a ready command
 * stays one, the rest go to the Reviewer with their catalogue key (`audio.critique.*`) and values. Findings are the
 * out-of-range metrics and the fixes' timestamps (frame and ms).
 */
import { RationalTime, type QaCheckResult, type QaFix, type SoundCritique } from '@taalcut/core';
import { agentFix, autoFix, checkResult, commandFix, skipped, type QaFinding } from '../result';
import { QA_THRESHOLDS } from '../thresholds.v1';

export interface SoundCritiqueInput {
  /** Null when the render couldn't be critiqued (too short, near silence, no model). */
  readonly critique: SoundCritique | null;
  /** Render frames per second. */
  readonly fps: number;
  readonly durationMs?: number;
}

/** The QA fix for one critique fix. */
function qaFixOf(fix: SoundCritique['fixes'][number]): QaFix {
  if (fix.metricId === 'lufsI' || fix.metricId === 'truePeak') return autoFix('renormaliseAudio');
  if (fix.command) return commandFix(fix.messageKey, fix.command.name, fix.command.payload);
  return agentFix(fix.messageKey, fix.params);
}

export function soundCritiqueCheck(input: SoundCritiqueInput): QaCheckResult {
  const { critique } = input;
  const duration = input.durationMs ?? 0;
  if (!critique) return skipped('soundCritique', duration);
  const { warnVerdicts, warnBelowScore } = QA_THRESHOLDS.sound.critique;
  const warns = (warnVerdicts as readonly string[]).includes(critique.verdict);
  const fixes: QaFix[] = [];
  for (const fix of critique.fixes) {
    const qa = qaFixOf(fix);
    if (qa.kind === 'auto' && fixes.some((f) => f.kind === 'auto')) continue;
    fixes.push(qa);
  }
  const findings: QaFinding[] = [
    ...critique.metrics
      .filter((m) => m.status === 'low' || m.status === 'high')
      .map((m): QaFinding => ({ target: { kind: 'audio', id: m.id } })),
    ...critique.fixes.flatMap((fix): QaFinding[] => {
      if (!fix.at) return [];
      const seconds = RationalTime.toSeconds(fix.at);
      const frame = Math.max(0, Math.floor(seconds * input.fps));
      return [
        {
          frames: { start: frame, end: frame + 1 },
          target: { kind: 'audio', id: fix.metricId ?? 'sound' },
          // Where it applies, to the ms (EAR1-A4: a creation's note names the time).
          measured: { value: Math.round(seconds * 1000), unit: 'ms' },
        },
      ];
    }),
  ];
  return checkResult(
    'soundCritique',
    warns ? 'warn' : 'pass',
    {
      measured: { value: Math.round(critique.score * 100), unit: 'percent' },
      threshold: { min: warnBelowScore * 100, unit: 'percent' },
      // Kept on a pass too: what is out of range, and where (a creation's export reads its silences).
      findings,
      fixes,
      // A warning never blocks; the person may always export.
      overridable: true,
    },
    duration,
  );
}
