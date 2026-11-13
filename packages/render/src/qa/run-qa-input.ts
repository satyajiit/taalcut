// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** What runQa reads (the render, its plan and the probes) and runs with; the QA modules read it too. */
import type {
  CaptionTrack,
  Clock,
  ComputeFallbackEvent,
  ExportPreset,
  QaCheckId,
  QaCheckResult,
  QaReport,
  RationalTime,
  Rect,
  RenderId,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import type { ProbedTextBox, ProbedVisual, QaPlan } from '../types';
import type { GlyphChecker, QaTarget } from './checks/captions';
import type { FaceBoxesDump } from './checks/faces';
import type { GraphicMeasureCache } from './graphic-measures';
import type { QaFacts } from './modules/facts';

export interface RunQaInput {
  readonly renderId: RenderId;
  /** 1 to QA_MAX_ROUNDS, counted across the supersede chain. */
  readonly round: number;
  /** The muxed render in its work folder. */
  readonly file: string;
  readonly plan: QaPlan;
  readonly preset: ExportPreset;
  /** For the ready-to-dispatch command fixes. */
  readonly target: QaTarget;
  readonly captions: CaptionTrack | null;
  /** The checks run before rendering (runPreflight), kept in the report. */
  readonly preflight?: readonly QaCheckResult[];
  /** Each clip's conformed segment and the render frame of its first frame. */
  readonly segments?: ReadonlyMap<string, { readonly path: string; readonly startFrame: number }>;
  /** avSync sources by the plan's sourceId; `offset` is the file time at render time zero. */
  readonly audioSources?: ReadonlyMap<string, { readonly path: string; readonly offset: RationalTime }>;
  /** The DOM probe: every visible text element at each frame asked for. */
  readonly probe?: (frames: readonly number[]) => Promise<readonly ProbedTextBox[]>;
  /** The DOM probe with every visual's applied crop (P3-V2's subjectInFrame). */
  readonly probeFrame?: (
    frames: readonly number[],
  ) => Promise<{ readonly boxes: readonly ProbedTextBox[]; readonly visuals: readonly ProbedVisual[] }>;
  /** Mean colour under a box at a frame with the text hidden, '#rrggbb'. */
  readonly sampleUnderBox?: (frame: number, box: Rect) => Promise<string>;
  /** The cmap coverage check; captionGlyphIssues unless a test swaps it. */
  readonly glyphIssues?: GlyphChecker;
  /** HFW1: the graphics checks' measurements by what a graphic draws; absent, every graphic is measured. */
  readonly graphicMeasures?: GraphicMeasureCache;
  /** P3: what the export knows that the Phase 3 checks read (qa/modules). */
  readonly facts?: QaFacts;
  /** FRM1-OVL, gates and evals: what graphicCoversFace saw (every item's probed box and the heads). */
  readonly onFaceBoxes?: (dump: FaceBoxesDump) => void | Promise<void>;
  /** Re-run only these after an auto fix; the rest come from `previous`. */
  readonly only?: readonly QaCheckId[];
  readonly previous?: QaReport;
}

export interface QaContext {
  readonly media: MediaContext;
  readonly clock: Pick<Clock, 'now'>;
  readonly signal?: AbortSignal;
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
  /** Tests and diagnostics: skip VideoToolbox in the video pass. */
  readonly decode?: 'auto' | 'software';
}
