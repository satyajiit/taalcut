// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Index stages and the indexing namespace (P2-L13). The contract between
 * the library's pipeline and the packages that do the work: a stage builds
 * a job from what the library knows about an asset and hands back results
 * the library knows how to store, so the library never imports media,
 * vision or audio. `indexingContract` is served by the jobs process.
 */
import '../basics/zod-config';
import { z } from 'zod';
import type { DerivedFileRef, MediaFacts } from '../analysis/media-facts';
import type { ShotAnalysis } from '../analysis/shot-analysis';
import type { SpokenLanguageOutcome } from '../analysis/language';
import type { SpokenLanguage, Transcript } from '../analysis/transcript';
import { idSchema, type AssetId, type ShotId, type SourceId } from '../basics/ids';
import type { Result } from '../basics/result';
import { ipc } from '../ipc/contract';
import type { JobKind } from '../jobs/job-kind';
import type { JobPriority } from '../jobs/job-types';
import type { EmbeddingItemKind } from '../ports/embedder';
import type { BeatMap } from '../templates/template-parts';
import type { TimeRange } from '../time/time-range';
import { INDEX_MILESTONES, indexMilestoneSchema, type IndexMilestone } from './index-milestones';
import { ASSET_KINDS, type AssetKind } from './library-types';

/** What the library knows about an asset when a stage builds its job. */
export interface AssetIndexView {
  readonly assetId: AssetId;
  readonly generation: number;
  readonly kind: AssetKind;
  /** A present original, the managed copy first. Stages wait while there is none. */
  readonly path: string;
  /** BLAKE3; every stage after library.hash has it. */
  readonly contentHash: string;
  readonly sizeBytes: number;
  /** The source of the location `path` is in (vector metadata). */
  readonly sourceId: SourceId;
  readonly capturedAt: number | null;
  readonly facts: MediaFacts | null;
  readonly derived: readonly DerivedFileRef[];
  readonly shots: readonly {
    readonly shotId: ShotId;
    readonly range: TimeRange;
    readonly analysis: ShotAnalysis | null;
  }[];
  readonly transcript: Transcript | null;
  /** Each finished stage's job output, as stored (≤ 1 MiB each), e.g. media's normalisation plan. */
  readonly outputs: Readonly<Record<string, unknown>>;
  /**
   * The spoken language the person chose for this clip (LIB1-LANG, library.setAssetLanguage), which the speech
   * stages obey instead of detecting; null or absent when they didn't.
   */
  readonly chosenLanguage?: SpokenLanguage | null;
}

/** What a stage hands back for the library to store. Each field replaces what the asset had for that part. */
export interface IndexStageResult {
  readonly facts?: MediaFacts;
  /** Merged by kind: a new thumbnail replaces the old one. */
  readonly derived?: readonly DerivedFileRef[];
  /** Replaces the shot list; a range that didn't move keeps its ShotId. */
  readonly shots?: readonly TimeRange[];
  readonly analyses?: readonly { readonly shotId: ShotId; readonly analysis: ShotAnalysis }[];
  readonly descriptions?: readonly {
    readonly shotId: ShotId;
    readonly description: NonNullable<ShotAnalysis['description']>;
  }[];
  /** null: the asset has no speech. */
  readonly transcript?: Transcript | null;
  readonly language?: SpokenLanguage;
  /**
   * How the spoken language was decided (LIB1-LANG): the library files the asset under its first language, and under
   * none when it is unclear. A language the person chose is never replaced by detection.
   */
  readonly spokenLanguage?: SpokenLanguageOutcome;
  /** A music file's beats, downbeats and tempo (audio.beats), for the timeline's re-time to the user's track. */
  readonly beats?: BeatMap;
}

/** One job for one asset; build it with stageJob so the input is checked against the kind. */
export interface IndexStageJob {
  readonly kind: JobKind<unknown, unknown>;
  readonly input: unknown;
  /** Default: the stage's priority (raised to 'high' while someone waits for the asset). */
  readonly priority?: JobPriority;
}

export function stageJob<I, O>(
  kind: JobKind<I, O>,
  input: NoInfer<I>,
  priority?: JobPriority,
): IndexStageJob {
  return {
    kind: kind as unknown as JobKind<unknown, unknown>,
    input,
    ...(priority !== undefined ? { priority } : {}),
  };
}

/** '<package>.<camelCase>', e.g. 'vision.shots'. Stored per asset; never renamed. */
export const indexStageNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*\.[a-z][a-zA-Z0-9]*$/)
  .max(60);

/** A stage with nothing to do for an asset: why (an i18n key), and what of an earlier run goes with it. */
export interface IndexStageSkip {
  readonly skip: string;
  /**
   * The asset's vectors of these kinds go (round IX3): what an earlier run embedded and nothing stands for now,
   * e.g. transcript vectors once the clip turned silent.
   */
  readonly clears?: readonly EmbeddingItemKind[];
}

export interface IndexStageDefinition {
  readonly stage: string;
  /** Bump to run the stage again on assets an older version indexed. */
  readonly version: number;
  /**
   * The stages whose stored output this one reads (round IX3, dependent invalidation): their rows' outputs, or
   * the facts, shots, analyses or transcript they store. When one of them runs again and what it stores changed,
   * this stage runs again. Each is one of its needs or a need of one (the pipeline checks). Absent: none.
   */
  readonly reads?: readonly string[];
  /**
   * Stages whose stored output this one uses when it can have it but never waits for when it can't (LRN1-CTX):
   * context that makes the output better and must not hold it back, such as a transcript whose speech model the
   * user may not have. The stage waits for each while it is still coming, as for a need, and stops waiting once it
   * can't come now (it, or a stage it needs, failed or is held for its model); then it runs with whatever is stored.
   * When one of them later stores something else, the first store after this stage ran included, this stage runs
   * again. Each declares what it `stores`. None may also be among `reads` or `needs`. Absent: none.
   */
  readonly optionalReads?: readonly string[];
  /**
   * What of the asset's stored state is this stage's and read by later stages, taken from the asset's view once
   * its result (or its skip) is stored (round IX3). The pipeline keeps a digest of it per asset and runs the
   * stages that read this one again when a run changes it. Leave out what describes the run (decode counts, the
   * backend) and what other stages store in the same records. Every stage another one reads declares it.
   */
  readonly stores?: (view: AssetIndexView) => unknown;
  /** Stages that must be done or skipped first; a need that doesn't apply to the asset's kind counts as met. */
  readonly needs: readonly string[];
  readonly appliesTo: readonly AssetKind[];
  /** While nobody waits for the asset. */
  readonly priority: JobPriority;
  /**
   * The finish line the stage counts toward (round IX): 'searchable' stages
   * must be done or skipped before the asset is searchable; every stage
   * counts toward 'complete'. Absent: 'complete' (indexStageMilestone). A
   * searchable stage may need only searchable stages (checkIndexStageMilestones).
   */
  readonly milestone?: IndexMilestone;
  /** The job for this asset, or a reason (i18n key) to skip the stage, e.g. no audio track. */
  job(view: AssetIndexView): IndexStageJob | IndexStageSkip;
  /** What to store from the job's output (already validated by its kind). */
  result(output: unknown, view: AssetIndexView): Result<IndexStageResult>;
}

/** Throws on a bad stage name, version, need, read, asset kind or milestone (a bug), like defineJobKind. */
export function defineIndexStage(spec: IndexStageDefinition): IndexStageDefinition {
  if (!indexStageNameSchema.safeParse(spec.stage).success)
    throw new Error(`Invalid index stage '${spec.stage}'.`);
  if (!Number.isInteger(spec.version) || spec.version < 1)
    throw new Error(`Index stage '${spec.stage}' needs a positive integer version.`);
  if (spec.needs.some((need) => need === spec.stage || !indexStageNameSchema.safeParse(need).success))
    throw new Error(`Index stage '${spec.stage}' needs an invalid stage.`);
  if ((spec.reads ?? []).some((read) => read === spec.stage || !indexStageNameSchema.safeParse(read).success))
    throw new Error(`Index stage '${spec.stage}' reads an invalid stage.`);
  const optional = spec.optionalReads ?? [];
  if (optional.some((read) => read === spec.stage || !indexStageNameSchema.safeParse(read).success))
    throw new Error(`Index stage '${spec.stage}' reads an invalid stage.`);
  const twice = optional.find((read) => spec.needs.includes(read) || (spec.reads ?? []).includes(read));
  if (twice !== undefined)
    throw new Error(
      `Index stage '${spec.stage}' lists '${twice}' as an optional read and as a read or need.`,
    );
  if (spec.appliesTo.length === 0 || spec.appliesTo.some((kind) => !ASSET_KINDS.includes(kind)))
    throw new Error(`Index stage '${spec.stage}' names no asset kind or an unknown one.`);
  if (spec.milestone !== undefined && !INDEX_MILESTONES.includes(spec.milestone))
    throw new Error(`Index stage '${spec.stage}' names an unknown milestone.`);
  return spec;
}

/** Near-duplicate grouping across the library (G25), run when analyses settle. */
export interface DuplicateGroup {
  readonly shotIds: readonly ShotId[];
  readonly bestShotId: ShotId;
}
export interface DuplicateShotView {
  readonly shotId: ShotId;
  readonly assetId: AssetId;
  readonly sourceId: SourceId;
  readonly capturedAt: number | null;
  readonly range: TimeRange;
  readonly analysis: ShotAnalysis;
}
export interface DuplicatePassDefinition {
  /** Runs after any of these stages finish, debounced. */
  readonly after: readonly string[];
  job(shots: readonly DuplicateShotView[]): IndexStageJob;
  groups(output: unknown): Result<readonly DuplicateGroup[]>;
}

const count = z.int().nonnegative();
/**
 * Each asset counts once in done, active, waiting or failed (they sum to
 * `assets`). `searchable` counts across them (round IX): assets whose
 * searchable stages are all done or skipped, so every done asset and some
 * active or failed ones (a failed complete-only stage). Absent from a
 * status made before round IX.
 */
export const indexCountsSchema = z.object({
  assets: count,
  done: count,
  active: count,
  waiting: count,
  failed: count,
  searchable: count.optional(),
  /** LIB1-PROG: of `waiting`, the assets held for a model or their original (index-progress.ts): none of it runs. */
  held: count.optional(),
});

export const IMPORT_STATES = ['scanning', 'receiving', 'indexing', 'done', 'paused', 'failed'] as const;

/** One source's import: what the importProgress card shows. */
export const importStatusSchema = z.object({
  sourceId: idSchema<'Source'>(),
  state: z.enum(IMPORT_STATES),
  counts: indexCountsSchema,
  /** Stages with work done or left, in pipeline order; `milestone` since round IX (absent before: unknown). */
  stages: z
    .array(
      z.object({
        stage: indexStageNameSchema,
        done: count,
        left: count,
        failed: count,
        milestone: indexMilestoneSchema.optional(),
        /**
         * Of `left`, the rows waiting for an on-device model or runtime to be installed (`library.stage.modelMissing`,
         * UX3-IDX): the import can say what waits for a download instead of counting it as failed. Absent: a status
         * made before UX3, or none.
         */
        waitingForModel: count.optional(),
      }),
    )
    .max(16),
  etaMs: count.nullable(),
  /** The source's running jobs, so a card can follow their job.progress events. */
  jobIds: z.array(idSchema<'Job'>()).max(64),
  updatedAt: count,
});
export type ImportStatus = z.output<typeof importStatusSchema>;

export const indexingStatusSchema = z.object({
  paused: z.boolean(),
  overall: indexCountsSchema,
  /** Sources with work done in the last hour or left; others are idle. */
  sources: z.array(importStatusSchema).max(200),
  etaMs: count.nullable(),
  updatedAt: count,
});
export type IndexingStatus = z.output<typeof indexingStatusSchema>;

/** appContract.indexing, owner jobs (indexingRouter in @taalcut/library). Not commands: scheduling, like jobs.pause. */
export const indexingContract = {
  status: ipc.output(indexingStatusSchema),
  /**
   * Someone is waiting for these assets: their remaining stages run first for the next 10 minutes, and a file of
   * theirs the media cache let go is made again first. It keeps nothing in the cache: the files of a clip a window
   * shows stay because main lists the clips its windows show (UX2 round 4).
   */
  prioritise: ipc
    .input(z.object({ assetIds: z.array(idSchema<'Asset'>()).min(1).max(200) }))
    .output(z.object({ boosted: count })),
  pause: ipc.output(indexingStatusSchema),
  resume: ipc.output(indexingStatusSchema),
  retryFailed: ipc
    .input(z.object({ sourceId: idSchema<'Source'>().optional() }))
    .output(z.object({ requeued: count })),
};
