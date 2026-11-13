// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The four systems the Phase 2 evals call. Each real package (library, timeline,
 * templates, render) is wired by replacing one file under src/adapters/. Tests
 * inject a synthetic implementation. Labels name an asset by its path in the
 * library manifest, plus an optional half-open frame range, so they survive
 * re-indexing.
 */

export interface FrameRange {
  /** Inclusive. */
  startFrame: number;
  /** Exclusive. */
  endFrame: number;
}

/** A shot as a labeller wrote it, or as a prediction ranked it. */
export interface EvalShot {
  asset: string;
  range?: FrameRange;
}

export type EvalLanguage = 'en' | 'hi' | 'es' | 'pt-BR';

export interface SearchFilters {
  orientation?: 'landscape' | 'portrait' | 'square';
  minFrames?: number;
  maxFrames?: number;
  minQuality?: number;
  /** ISO date (YYYY-MM-DD), inclusive. */
  capturedAfter?: string;
  /** ISO date (YYYY-MM-DD), exclusive. */
  capturedBefore?: string;
}

export interface SearchQuery {
  queryId: string;
  language: EvalLanguage;
  library: string;
  text: string;
  filters?: SearchFilters;
}

/**
 * Search. The real adapter calls `library.search` and maps each `SearchHit`
 * onto an `EvalShot` (asset path from the manifest, frames from `shot.range`).
 */
export interface SearchSystem {
  search(query: SearchQuery, limit: number): Promise<EvalShot[]>;
}

/** Weights the casting tuner may change. The engine's fixed constants stay out. */
export interface CastingWeights {
  version: string;
  intent: number;
  motion: number;
  quality: number;
  subject: number;
  energy: number;
}

export interface CastingCaseInput {
  caseId: string;
  library: string;
  /** A TemplateV1 fixture path, or a brief the story-order path plans. */
  template: { file: string } | { brief: { text: string; formatId: string; targetSeconds: number } };
  slotCount: number;
  weights: CastingWeights;
  seed: number;
}

export interface CastingPick {
  slotIndex: number;
  asset: string;
  range?: FrameRange;
}

export interface CastingVariant {
  picks: CastingPick[];
  alternates: { slotIndex: number; shots: EvalShot[] }[];
}

/**
 * Casting. The real adapter calls the timeline package's casting engine
 * (vision rerank off, or on with recorded responses) and maps `SlotCast`
 * picks back to manifest paths.
 */
export interface CastingSystem {
  /** `variants[0]` is variant 1, the one gate criterion 2 scores. */
  cast(input: CastingCaseInput): Promise<CastingVariant[]>;
}

export interface BreakdownInput {
  reelId: string;
  /** Generated or labelled media. Empty when the scorer only has a cut list. */
  mediaPath?: string;
  frameRate: { numerator: number; denominator: number };
  durationFrames: number;
}

/**
 * Breakdown. The real adapter calls the templates breakdown pipeline and
 * returns confirmed cut frames at the reel's rate.
 */
export interface BreakdownSystem {
  predictCuts(input: BreakdownInput): Promise<number[]>;
}

/**
 * What a render golden asks the renderer to make. The document is the eval
 * golden (`src/render/schema.ts`). The real adapter maps it onto core's
 * `Timeline` and calls `render.export` without the QA round-trip, then
 * `render.qa` for the tracked first-pass share.
 */
export interface RenderRequest {
  goldenId: string;
  timeline: unknown;
  outPath: string;
  /**
   * Move one cut by this many frames before rendering, so the timing check
   * can be proved. The checker still expects the unshifted golden.
   */
  cutShiftFrames?: { clipIndex: number; frames: number };
}

export interface RenderOutput {
  videoPath: string;
  /** Set when the adapter also ran `render.qa`. Never fails the suite. */
  qaPassed?: boolean;
}

export interface RenderSystem {
  render(request: RenderRequest): Promise<RenderOutput>;
}

/** The verdict and the ids of the checks that failed and that warned. */
export interface RenderQaOutcome {
  readonly verdict: string | null;
  readonly failed: readonly string[];
  readonly warned: readonly string[];
}

/** One nightly sample. The script turns it into JSONL rows. */
export interface PerfSample {
  indexMinutes: number;
  previewMedianFps: number;
  previewP5Fps: number;
  droppedFrames: number;
  renderSeconds: number;
  /** Peak resident bytes, keyed by process name. */
  memoryBytes: Record<string, number>;
}

export interface PerfMeasureInput {
  footage: 'device-lab' | 'synthetic';
  runnerId: string;
}

/**
 * Nightly performance. The real adapter times indexing, preview, render and
 * `app.getAppMetrics()` on the self-hosted runner. Tests inject a fake.
 */
export interface PerfSystem {
  measure(input: PerfMeasureInput): Promise<PerfSample>;
}
