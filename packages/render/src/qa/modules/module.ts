// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Phase 3's QA checks as modules (SPEC P3.10): each names its checks, the frames it wants the DOM probe at,
 * and runs on the facts the export gathered (`QaFacts`). runQa runs every module in QA_MODULES; a new check is
 * a new module and one entry in the list, not a new branch in runQa.
 */
import type { QaCheckId, QaCheckResult } from '@taalcut/core';
import type { ProbedTextBox, ProbedVisual } from '../../types';
import type { RunQaInput } from '../run-qa-input';
import type { QaFacts } from './facts';

/** What the DOM probe saw at the frames every check asked for; null when it couldn't run. */
export interface ProbedFrames {
  readonly boxes: readonly ProbedTextBox[];
  readonly visuals: readonly ProbedVisual[];
}

export interface QaModuleInput {
  readonly run: RunQaInput;
  readonly facts: QaFacts;
  readonly probed: ProbedFrames | null;
  /** The QA run's cancellation (QaContext.signal), for work a module starts in another process. */
  readonly signal?: AbortSignal;
}

export interface QaCheckModule {
  readonly ids: readonly QaCheckId[];
  /** Frames the probe must read for these checks (none: the module doesn't need it). */
  probeFrames(input: Pick<QaModuleInput, 'run' | 'facts'>): readonly number[];
  run(input: QaModuleInput, wanted: ReadonlySet<QaCheckId>): Promise<QaCheckResult[]>;
}
