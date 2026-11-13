// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type TelemetryEnvelope } from '@taalcut/core';
import { type PerfRow } from '../../perf/schema';
import { type CohortName, type GateId, type LanguageName } from '../slices';

export interface SourceRef {
  path: string;
  sha256: string;
  synthetic: boolean;
}

export interface Absent {
  kind: 'absent';
}

export function isPresent<T extends { kind: 'present' }>(value: T | Absent): value is T {
  return value.kind === 'present';
}

export interface InstallRollup {
  installId: string;
  cohort: CohortName | null;
  language: LanguageName | null;
  /** The install's earliest event anywhere in the export, inside the window or not. */
  firstSeenAt: number;
  /** First seen at or after `--from`: its first session and first export can fall in the window. */
  newInWindow: boolean;
  /** Only the envelopes inside the window, oldest first. */
  envelopes: TelemetryEnvelope[];
}

export interface TelemetryInput {
  kind: 'present';
  installs: InstallRollup[];
  sources: SourceRef[];
  synthetic: boolean;
}

/** A moderated session. Sessions are their own population (new creators on clean Macs): sliced by language only. */
export interface UsabilitySession {
  language: LanguageName;
  /** Null when the participant never exported in the session. */
  seconds: number | null;
  source: SourceRef;
}

export interface SessionsInput {
  kind: 'present';
  sessions: UsabilitySession[];
  sources: SourceRef[];
  synthetic: boolean;
}

export interface SearchLanguageRow {
  language: LanguageName | 'overall';
  queries: number;
  hitAt5: number;
}

export interface EvalInput {
  kind: 'present';
  sources: SourceRef[];
  synthetic: boolean;
  search: { rows: SearchLanguageRow[]; source: SourceRef } | null;
  /** Casting `pickAcceptance`. Null when the report has no such metric. */
  casting: { pickAcceptance: number | null; source: SourceRef } | null;
  /** Render-golden `qaFirstPass`. Null when the report has no such metric. */
  render: { qaFirstPass: number | null; source: SourceRef } | null;
  /**
   * The breakdown headline (FORMAT.md, the alpha gate's number): reels with at least 90% of cuts within 2 frames.
   * Beside it, the micro share of every cut within 2 frames and the reels with no missed cut at all.
   */
  breakdown: {
    reelsMeetingBar: number;
    reels: number;
    cutShare: number;
    missedEmpty: number;
    source: SourceRef;
  } | null;
}

export interface CrashRow {
  release: string;
  channel: string;
  sessions: number;
  crashedSessions: number;
}

export interface CrashesInput {
  kind: 'present';
  rows: CrashRow[];
  source: SourceRef;
}

export interface CiMetric {
  name: string;
  value: number;
  unit: string;
}

export interface CiResult {
  id: string;
  pass: boolean;
  synthetic: boolean;
  detail: string;
  metrics: CiMetric[];
  source: SourceRef;
}

export interface CiInput {
  kind: 'present';
  results: CiResult[];
  sources: SourceRef[];
}

export interface PerfInput {
  kind: 'present';
  rows: PerfRow[];
  sources: SourceRef[];
  synthetic: boolean;
}

export interface ManualRow {
  gate: GateId;
  row: number;
  pass: boolean;
  signedBy: string;
  at: string;
  evidence: string;
}

export interface ManualInput {
  kind: 'present';
  synthetic: boolean;
  rows: ManualRow[];
  source: SourceRef;
}

export interface GateInputs {
  gate: GateId;
  from: string;
  to: string;
  fromMs: number;
  toMs: number;
  telemetry: TelemetryInput | Absent;
  evals: EvalInput | Absent;
  sessions: SessionsInput | Absent;
  crashes: CrashesInput | Absent;
  ci: CiInput | Absent;
  perf: PerfInput | Absent;
  manual: ManualInput | Absent;
}
