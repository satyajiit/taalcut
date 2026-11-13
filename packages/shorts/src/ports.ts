// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type {
  AssetId,
  AsyncResult,
  BackgroundModels,
  BackgroundPlacement,
  RationalTime,
  Result,
  ShortEditPlan,
  ShortsCache,
  ShortsRequest,
  ShortsRun,
  ShortsRunId,
  ShortsRunStore,
  TimelineId,
  TimeRange,
  TranscriptSegment,
  RenderId,
} from '@taalcut/core';

export interface SourceDescription {
  readonly contentHash: string;
  /** Changes when transcript, scene descriptions, OCR or their recipe changes. */
  readonly analysisVersion: string;
  readonly duration: RationalTime;
  readonly hasAudio: boolean;
}

export interface SourceVisual {
  readonly id: string;
  readonly range: TimeRange;
  readonly description: string;
  readonly onScreenText?: string;
}
export interface SourceFrame {
  readonly at: RationalTime;
  readonly data: string;
  readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}

/** The desktop adapts library reads. No truncated asset-detail transcript is accepted here. */
export interface ShortsSourcePort {
  describe(assetId: AssetId, signal?: AbortSignal): AsyncResult<SourceDescription>;
  transcript(
    assetId: AssetId,
    fromSegment: number,
    limit: number,
    signal?: AbortSignal,
  ): AsyncResult<{
    readonly segments: readonly TranscriptSegment[];
    readonly nextSegment?: number;
  } | null>;
  visuals(
    assetId: AssetId,
    from: number,
    limit: number,
    signal?: AbortSignal,
  ): AsyncResult<{
    readonly items: readonly SourceVisual[];
    readonly next?: number;
  }>;
  /** Sampled original frames for checking shortlisted edits, using the existing GPU media path. */
  frames?(
    assetId: AssetId,
    ranges: readonly TimeRange[],
    signal?: AbortSignal,
  ): AsyncResult<readonly SourceFrame[]>;
}

export interface ShortsOptions {
  readonly runId?: ShortsRunId;
  readonly signal?: AbortSignal;
  readonly progress?: (run: ShortsRun) => void;
}

export interface ShortsDependencies {
  readonly source: ShortsSourcePort;
  readonly models: BackgroundModels;
  readonly cache: ShortsCache;
  readonly runs: ShortsRunStore;
  readonly placement: () => BackgroundPlacement;
  /** Provider/model/profile revision: model changes invalidate editorial analysis. */
  readonly modelKey: () => string;
  /** Share one coordinator across tool-call service instances in the same process. */
  readonly coordinator?: ShortsCoordinator;
  /** The desktop checks the project's remaining model budget before every request. */
  readonly beforeModel?: (request: ShortsRequest) => AsyncResult<void>;
  /** Must be idempotent by runId, including after a crash between timeline creation and saving the run. */
  readonly compose: (
    runId: ShortsRunId,
    request: ShortsRequest,
    plan: ShortEditPlan,
    signal?: AbortSignal,
  ) => AsyncResult<{
    readonly timelineId: TimelineId;
    readonly revision: number;
    readonly renderIds?: RenderId[];
    readonly issues?: string[];
  }>;
  readonly now?: () => number;
}

export interface ShortsCoordinator {
  readonly active: Map<string, Promise<Result<ShortsRun>>>;
}
export const createShortsCoordinator = (): ShortsCoordinator => ({ active: new Map() });
