// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type {
  AssetId,
  AsyncResult,
  CreationBrief,
  CreationDraft,
  CreationProject,
  CreationSource,
  CreationStore,
  CreationTask,
  ProjectId,
  TimelineId,
} from '@taalcut/core';

export interface CreationModelRequest {
  readonly projectId: ProjectId;
  readonly role: CreationTask['role'];
  readonly system: string;
  readonly prompt: string;
  readonly maxTokens: number;
  readonly signal: AbortSignal;
  readonly taskId: string;
  readonly imageAssetIds?: readonly AssetId[];
}
export interface CreationModel {
  complete(request: CreationModelRequest): AsyncResult<{ text: string; usageMicros: number; tokens: number }>;
  /** Conservative reservation, including input and maximum output. Shared by every child of this project. */
  estimate(request: Omit<CreationModelRequest, 'signal' | 'taskId'>): number;
}
export interface CreationScene {
  readonly beatId: string;
  readonly format: CreationBrief['formats'][number];
  readonly html: string;
  readonly css: string;
  /** Statements on the parent's `tl`, with absolute seconds. Never a second clock. */
  readonly animation: string;
}
export interface CreationVoiceArtifact {
  readonly usageMicros: number;
  readonly assetIds: readonly AssetId[];
  readonly lines: readonly {
    readonly beatId: string;
    readonly assetId: AssetId;
    readonly durationMs: number;
    readonly sourceStartMs?: number;
  }[];
}
export interface CreationPublishInput {
  readonly project: CreationProject;
  readonly draft: CreationDraft;
  readonly scenes: readonly CreationScene[];
  readonly masterScenes?: readonly CreationScene[];
  readonly voice: CreationVoiceArtifact | null;
}
export interface CreationDirectorDeps {
  readonly store: CreationStore;
  readonly sources: { inspect(source: CreationSource, signal: AbortSignal): AsyncResult<CreationSource> };
  readonly model: CreationModel;
  readonly logos?: {
    find(
      name: string,
      signal: AbortSignal,
    ): AsyncResult<
      readonly {
        readonly name: string;
        readonly sourceUrl: string;
        readonly svg: string;
      }[]
    >;
  };
  readonly preview: (
    scene: CreationScene,
    brief: CreationBrief,
    signal: AbortSignal,
    projectId: ProjectId,
  ) => AsyncResult<AssetId>;
  readonly estimateVoice: (project: CreationProject, draft: CreationDraft) => number;
  readonly voice: (
    project: CreationProject,
    draft: CreationDraft,
    signal: AbortSignal,
  ) => AsyncResult<CreationVoiceArtifact>;
  /** Uses project+approved draft as its idempotency key and publishes editable source plus separate audio. */
  readonly publish: (input: CreationPublishInput, signal: AbortSignal) => AsyncResult<TimelineId>;
  readonly review: (
    timelineId: TimelineId,
    signal: AbortSignal,
  ) => AsyncResult<{ passed: boolean; notes: readonly string[]; frameAssetIds?: readonly AssetId[] }>;
  readonly finalize: (timelineId: TimelineId, signal: AbortSignal) => AsyncResult<void>;
  readonly now?: () => number;
}
