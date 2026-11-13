// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The check catalogue (docs/qa-gate.md, "Checks") and small builders for
 * core's QaCheckResult, so every check reports the same way: label key,
 * capped findings and fixes, its own duration.
 */
import type { ProjectId, QaCheckId, QaCheckResult, QaFix, QA_STATUSES, QA_UNITS, TimelineId } from '@taalcut/core';
import type { FrameSpan } from '../plan/types';

export type QaStatus = (typeof QA_STATUSES)[number];
export type QaUnit = (typeof QA_UNITS)[number];
export type QaFinding = QaCheckResult['findings'][number];

export const QA_CHECK_GROUPS = [
  'preflight',
  'format',
  'video',
  'audio',
  'captions',
  // Phase 3 (SPEC P3.10).
  'reframe',
  'graphics',
  'credentials',
  'brand',
  // LRN1-STY.
  'style',
  // AGT2-MATCH: the draft against its template, slot by slot.
  'slots',
] as const;
export type QaCheckGroup = (typeof QA_CHECK_GROUPS)[number];

export interface QaCheckMeta {
  readonly id: QaCheckId;
  readonly group: QaCheckGroup;
  /** Runs before rendering (cheap failures never cost a render). */
  readonly preflight: boolean;
  /** May the user export with it failing ("Export anyway")? `duration`: only below the minimum. */
  readonly overridable: boolean | 'belowMinimum';
}

/** Every check, in report order, with qa-gate.md's override rules. */
export const QA_CHECKS: readonly QaCheckMeta[] = [
  { id: 'preflightMedia', group: 'preflight', preflight: true, overridable: false },
  { id: 'preflightFonts', group: 'preflight', preflight: true, overridable: false },
  { id: 'rightsReferenceAudio', group: 'preflight', preflight: true, overridable: false },
  { id: 'container', group: 'format', preflight: false, overridable: false },
  { id: 'codec', group: 'format', preflight: false, overridable: false },
  { id: 'resolution', group: 'format', preflight: false, overridable: false },
  { id: 'aspectRatio', group: 'format', preflight: false, overridable: false },
  { id: 'frameRate', group: 'format', preflight: false, overridable: false },
  { id: 'duration', group: 'format', preflight: false, overridable: 'belowMinimum' },
  { id: 'bitrate', group: 'format', preflight: false, overridable: false },
  { id: 'blackFrames', group: 'video', preflight: false, overridable: true },
  { id: 'frozenFrames', group: 'video', preflight: false, overridable: true },
  { id: 'blackBars', group: 'video', preflight: false, overridable: false },
  { id: 'avSync', group: 'audio', preflight: false, overridable: false },
  { id: 'beatSync', group: 'audio', preflight: false, overridable: true },
  { id: 'loudness', group: 'audio', preflight: false, overridable: true },
  { id: 'silence', group: 'audio', preflight: false, overridable: false },
  { id: 'captionSafeZone', group: 'captions', preflight: false, overridable: true },
  { id: 'captionOverflow', group: 'captions', preflight: false, overridable: true },
  { id: 'captionGlyphs', group: 'captions', preflight: true, overridable: false },
  { id: 'captionReadability', group: 'captions', preflight: false, overridable: true },
  { id: 'subjectInFrame', group: 'reframe', preflight: false, overridable: true },
  { id: 'cropJitter', group: 'reframe', preflight: false, overridable: true },
  { id: 'captionCoversFace', group: 'reframe', preflight: false, overridable: true },
  { id: 'graphicsSafeZone', group: 'graphics', preflight: false, overridable: true },
  { id: 'graphicsOverlap', group: 'graphics', preflight: false, overridable: true },
  { id: 'graphicsReadability', group: 'graphics', preflight: false, overridable: true },
  { id: 'voiceOverMusic', group: 'audio', preflight: false, overridable: true },
  { id: 'contentCredentials', group: 'credentials', preflight: false, overridable: false },
  { id: 'brandAssets', group: 'brand', preflight: false, overridable: true },
  { id: 'stylePacing', group: 'style', preflight: false, overridable: true },
  { id: 'graphicCoversFace', group: 'graphics', preflight: false, overridable: true },
  // AGT2-MATCH: a video may differ from its reel on purpose, so each is the person's to override.
  { id: 'slotNeeds', group: 'slots', preflight: false, overridable: true },
  { id: 'slotFace', group: 'slots', preflight: false, overridable: true },
  { id: 'slotFraming', group: 'slots', preflight: false, overridable: true },
  { id: 'slotMotion', group: 'slots', preflight: false, overridable: true },
  { id: 'slotTiming', group: 'slots', preflight: false, overridable: true },
  { id: 'slotGraphics', group: 'slots', preflight: false, overridable: true },
  // EAR1-A2: the render heard. Each is the person's to override; soundCritique only ever warns.
  { id: 'soundOnCuts', group: 'audio', preflight: false, overridable: true },
  { id: 'soundClean', group: 'audio', preflight: false, overridable: true },
  { id: 'soundCritique', group: 'audio', preflight: false, overridable: true },
];

export function checkMeta(id: QaCheckId): QaCheckMeta {
  const meta = QA_CHECKS.find((candidate) => candidate.id === id);
  if (!meta) throw new RangeError(`Unknown QA check '${id}'`);
  return meta;
}

const MAX_FINDINGS = 50;
const MAX_FIXES = 5;

export interface CheckFields {
  readonly measured?: { readonly value: number; readonly unit: QaUnit };
  readonly threshold?: { readonly min?: number; readonly max?: number; readonly unit: QaUnit };
  readonly findings?: readonly QaFinding[];
  readonly fixes?: readonly QaFix[];
  /** Overrides the catalogue (duration below its minimum). */
  readonly overridable?: boolean;
}

/** A finished check; `durationMs` is what its measurement took. Fixes are kept only while it fails or warns. */
export function checkResult(
  id: QaCheckId,
  status: QaStatus,
  fields: CheckFields,
  durationMs: number,
): QaCheckResult {
  const meta = checkMeta(id);
  return {
    id,
    status,
    labelKey: `qa.checks.${id}`,
    ...(fields.measured ? { measured: fields.measured } : {}),
    ...(fields.threshold ? { threshold: fields.threshold } : {}),
    findings: [...(fields.findings ?? [])].slice(0, MAX_FINDINGS),
    overridable: fields.overridable ?? meta.overridable === true,
    // Fixes only matter while a check is failing or warning.
    fixes: status === 'fail' || status === 'warn' ? [...(fields.fixes ?? [])].slice(0, MAX_FIXES) : [],
    durationMs: Math.max(0, Math.round(durationMs)),
  };
}

/** A check that doesn't apply to this render: loudness on a silent export, beatSync without anchors. */
export function skipped(id: QaCheckId, durationMs = 0): QaCheckResult {
  return checkResult(id, 'skipped', {}, durationMs);
}

export function spanFinding(
  frames: FrameSpan,
  target?: QaFinding['target'],
  measured?: QaFinding['measured'],
): QaFinding {
  return { frames: { start: frames.start, end: Math.max(frames.start, frames.end) }, ...(target ? { target } : {}), ...(measured ? { measured } : {}) };
}

export const autoFix = (action: 'renormaliseAudio' | 'remux' | 'reencode' | 'rerender'): QaFix => ({
  kind: 'auto',
  action,
});

/** The timeline a QA run checks: what command fixes address. */
export interface QaTarget {
  readonly projectId: ProjectId;
  readonly timelineId: TimelineId;
}

export const commandFix = (labelKey: string, command: string, payload: unknown): QaFix => ({
  kind: 'command',
  labelKey,
  command,
  payload,
});

export const agentFix = (instructionKey: string, params: Record<string, string | number>): QaFix => ({
  kind: 'agent',
  instructionKey,
  params,
});

/** Frames whose spans overlap: shared by intended-range and clip lookups. */
export function overlaps(a: FrameSpan, b: FrameSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

/** The part of `span` not covered by any of `covered` (sorted, merged ranges in, pieces out). */
export function outside(span: FrameSpan, covered: readonly FrameSpan[]): FrameSpan[] {
  let pieces: FrameSpan[] = [span];
  for (const cover of covered) {
    pieces = pieces.flatMap((piece) => {
      if (!overlaps(piece, cover)) return [piece];
      const parts: FrameSpan[] = [];
      if (piece.start < cover.start) parts.push({ start: piece.start, end: cover.start });
      if (cover.end < piece.end) parts.push({ start: cover.end, end: piece.end });
      return parts;
    });
  }
  return pieces.filter((piece) => piece.end > piece.start);
}

/** The clip whose cut contains most of `span`, for a finding's target. */
export function clipAt(
  clips: readonly { readonly id: string; readonly span: FrameSpan }[],
  span: FrameSpan,
): string | undefined {
  let best: string | undefined;
  let bestOverlap = 0;
  for (const clip of clips) {
    const overlap = Math.min(clip.span.end, span.end) - Math.max(clip.span.start, span.start);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = clip.id;
    }
  }
  return best;
}
