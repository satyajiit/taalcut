// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The indexing pipeline a bench run measured (IX-B1), recorded with the run
 * so its timeline is read against the code that ran, not the code that reads
 * it later: each index stage's needs, asset kinds and milestone (searchable
 * or complete, once stages declare one), and each indexing job kind's
 * resource class and lane (the model or process its jobs share, once kinds
 * declare one; core's IX contract). A kind missing here is reported as having
 * no lane by the analysis, never guessed. The stage list is the app's (roots/index-stages.ts),
 * built from the same package functions as make-flow-seed.ts.
 */
import type { IndexStageDefinition, JobKind } from '@taalcut/core';
import { audioIndexJobKinds, audioTrackBeatsJob, createAudioIndexStages } from '@taalcut/audio';
import { libraryHashStage } from '@taalcut/library';
import {
  createMediaIndexStages,
  mediaMakePreviewsJob,
  mediaMakeProxyJob,
  mediaNormaliseJob,
} from '@taalcut/media';
import { createVisionIndexStages, indexJobKinds } from '@taalcut/vision';

export interface PipelineStage {
  readonly stage: string;
  readonly version: number;
  readonly needs: readonly string[];
  readonly appliesTo: readonly string[];
  /** 'searchable' or 'complete' when the stage declares it (IX design C); null before it does. */
  readonly milestone: string | null;
}

export interface PipelineKind {
  readonly resource: string;
  /** Null until the kind declares a lane (IX design A). */
  readonly lane: string | null;
}

export interface PipelineGraph {
  readonly stages: readonly PipelineStage[];
  readonly kinds: Readonly<Record<string, PipelineKind>>;
}

function stageOf(definition: IndexStageDefinition): PipelineStage {
  return {
    stage: definition.stage,
    version: definition.version,
    needs: [...definition.needs],
    appliesTo: [...definition.appliesTo],
    // Raw, not indexStageMilestone(): the bench tells a declared milestone from the default.
    milestone: definition.milestone ?? null,
  };
}

function kindOf(kind: Pick<JobKind<never, unknown>, 'kind' | 'resource' | 'lane'>): [string, PipelineKind] {
  return [kind.kind, { resource: kind.resource, lane: kind.lane ?? null }];
}

export function pipelineGraph(): PipelineGraph {
  const stages = [
    libraryHashStage,
    ...createMediaIndexStages(),
    // The tier only changes how many frames a shot embeds, not the graph.
    ...createVisionIndexStages({ tier: 'recommended', ocrLanguages: () => ['en'], placement: () => 'local' }),
    ...createAudioIndexStages(),
  ];
  const kinds = [
    mediaNormaliseJob,
    mediaMakePreviewsJob,
    mediaMakeProxyJob,
    ...indexJobKinds,
    ...audioIndexJobKinds,
    audioTrackBeatsJob,
  ];
  return { stages: stages.map(stageOf), kinds: Object.fromEntries(kinds.map(kindOf)) };
}
