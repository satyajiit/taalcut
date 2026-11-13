// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The render fake's data: the export presets (render-presets.ts, the engine's
 * table), QA reports as the gate writes them (every check, a verdict, fixes),
 * and estimates for the export dialog.
 */
import {
  err,
  NotImplementedError,
  ok,
  QA_CHECK_IDS,
  type ExportPreset,
  type ExportPresetId,
  type QaCheckId,
  type QaCheckResult,
  type QaReport,
  type QaSummary,
  type RenderId,
  type Result,
} from '@taalcut/core';
import { PRESETS } from './render-presets';

/** A preset the engine renders, or the real export's answer for one it doesn't (none today: all seven are built). */
export function presetOf(id: ExportPresetId): Result<ExportPreset> {
  const preset = PRESETS.find((candidate) => candidate.id === id);
  return preset ? ok(preset) : err(NotImplementedError({ feature: `render.presets.${id}` }));
}

/** Bytes for `seconds` of video at the preset's bitrate, audio included. */
export function estimateBytes({ video, audio }: ExportPreset, seconds: number): number {
  return Math.round(((video.bitrateKbps + audio.bitrateKbps) * 1000 * seconds) / 8);
}

/** A render row's size: null for a preset the engine doesn't render (no such file is ever written). */
export function bytesOf(id: ExportPresetId, seconds: number): number | null {
  const preset = presetOf(id);
  return preset.ok ? estimateBytes(preset.value, seconds) : null;
}

const UNITS: Partial<Record<QaCheckId, QaCheckResult['measured']>> = {
  loudness: { value: -14.2, unit: 'lufs' },
  avSync: { value: 4, unit: 'ms' },
  beatSync: { value: 0, unit: 'frames' },
  duration: { value: 15, unit: 'seconds' },
  bitrate: { value: 11_840, unit: 'kbps' },
};

export interface QaPlan {
  readonly verdict: QaReport['verdict'];
  readonly round?: number;
  /** Checks that warn, fail or were fixed, with what they measured and their fixes. */
  readonly special?: Partial<Record<QaCheckId, Pick<QaCheckResult, 'status'> & Partial<QaCheckResult>>>;
}

/**
 * Phase 3's checks that look at a feature the fake's timelines don't use (reframed clips, motion graphics, voice
 * over music, a Style, a style profile): the real engine runs them and reports them skipped. contentCredentials runs on every render
 * (off: the file carries no manifest) and passes.
 */
const SKIPPED_WITHOUT_FEATURE: ReadonlySet<QaCheckId> = new Set<QaCheckId>([
  'subjectInFrame',
  'cropJitter',
  'captionCoversFace',
  'graphicsSafeZone',
  'graphicsOverlap',
  'graphicsReadability',
  'voiceOverMusic',
  'brandAssets',
  'stylePacing',
  'slotNeeds',
  'slotFace',
  'slotFraming',
  'slotMotion',
  'slotTiming',
  'slotGraphics',
]);

/** Every check the gate runs today, passing unless the plan says otherwise. */
export function qaReport(renderId: RenderId, presetId: ExportPresetId, plan: QaPlan, at: number): QaReport {
  return {
    version: 1,
    renderId,
    round: plan.round ?? 1,
    verdict: plan.verdict,
    presetId,
    checks: QA_CHECK_IDS.map((id) => ({
      id,
      status: SKIPPED_WITHOUT_FEATURE.has(id) ? 'skipped' : 'pass',
      labelKey: `qa.checks.${id}`,
      ...(UNITS[id] ? { measured: UNITS[id] } : {}),
      findings: [],
      overridable: false,
      fixes: [],
      durationMs: 40 + id.length * 7,
      ...plan.special?.[id],
    })),
    overrides: [],
    createdAt: at,
  };
}

/** As the engine's summarize (packages/render qa/verdict.ts): a skipped check counts neither way. */
export function summaryOf(report: QaReport): QaSummary {
  const count = (status: QaCheckResult['status']) =>
    report.checks.filter((check) => check.status === status).length;
  return {
    verdict: report.verdict,
    round: report.round,
    passed: count('pass'),
    warned: count('warn'),
    failed: count('fail'),
    fixed: count('fixed'),
    failing: report.checks.filter((check) => check.status === 'fail').map((check) => check.id),
  };
}

/** One loudness warning and one fix the gate made itself: the Golden hour export. */
export const WARNED: QaPlan = {
  verdict: 'passedWithWarnings',
  special: {
    loudness: {
      status: 'warn',
      measured: { value: -15.3, unit: 'lufs' },
      threshold: { min: -15, max: -13, unit: 'lufs' },
      fixes: [{ kind: 'auto', action: 'renormaliseAudio' }],
    },
    captionOverflow: { status: 'fixed', measured: { value: 2, unit: 'count' } },
  },
};

/** Captions under the app's buttons after three rounds: the user decides. */
export function needsAttention(projectId: string, timelineId: string): QaPlan {
  return {
    verdict: 'needsAttention',
    round: 3,
    special: {
      captionSafeZone: {
        status: 'fail',
        overridable: true,
        measured: { value: 64, unit: 'px' },
        findings: [{ frames: { start: 180, end: 240 }, target: { kind: 'caption', id: 'cue-2' } }],
        fixes: [
          {
            kind: 'command',
            labelKey: 'qa.fixes.moveCaptions',
            command: 'captions.setStyle',
            payload: { projectId, timelineId, style: { anchorY: 0.52 } },
          },
          {
            kind: 'command',
            labelKey: 'qa.fixes.shrinkCaptions',
            command: 'captions.setStyle',
            payload: { projectId, timelineId, style: { sizePx: 56 } },
          },
        ],
      },
      loudness: { status: 'fixed', measured: { value: -14.0, unit: 'lufs' } },
    },
  };
}
