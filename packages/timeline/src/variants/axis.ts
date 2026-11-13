// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A way variants of one cut can differ (P3-V3): the hook, the music or the caption look. Each axis is a module
 * (hook-axis.ts, music-axis.ts, caption-axis.ts) listed once in axes.ts; `planVariants` runs the asked axes in
 * core's VARIANT_AXES order, each varying the drafts the previous one left.
 */
import type {
  AsyncResult,
  CaptionPresetId,
  MusicChoice,
  Timeline,
  TimelineItemId,
  VariantAxis as VariantAxisId,
} from '@taalcut/core';
import type { CastingEngine } from '../casting/engine';
import type { EditConfig } from '../model/config';
import type { TemplateReader } from '../service/templates';
import type { VariantMusicDeps } from './variant-deps';

/** What the person or the agent asked for, without the ids the tool makes. */
export interface VariantPlanRequest {
  /** 2–5 variants. */
  readonly count: number;
  /** At least one; run in VARIANT_AXES order whatever order they come in. */
  readonly axes: readonly VariantAxisId[];
  /** Candidates for the music axis, the agent's picks, in order of preference. */
  readonly music?: readonly MusicChoice[];
  /** Candidates for the caption axis; absent: every preset in CAPTION_PRESET_IDS order. */
  readonly captionPresets?: readonly CaptionPresetId[];
}

export interface VariantContext {
  readonly engine: Pick<CastingEngine, 'hookVariants' | 'config'>;
  readonly templates: TemplateReader;
  /** Absent: an own track keeps the cuts where they are. */
  readonly music?: VariantMusicDeps;
  readonly config?: EditConfig;
  /** Ids for items an edit makes on the way (re-sync markers); the final ids come from the variant's identity. */
  readonly ids: () => TimelineItemId;
  readonly signal?: AbortSignal;
}

export interface AxisInput {
  readonly base: Timeline;
  /** One per variant still in the set; the first axis gets `count` copies of the base. */
  readonly drafts: readonly Timeline[];
  readonly request: VariantPlanRequest;
}

export interface VariantAxis {
  readonly id: VariantAxisId;
  /**
   * The drafts varied on this axis, in order, each different from the base and from the drafts before it. Fewer
   * than given when the candidates or the library ran out; none when the axis can't vary this base at all.
   */
  vary(input: AxisInput, context: VariantContext): AsyncResult<Timeline[]>;
}
