// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the jobs process gives vision's job handlers. Building the handlers
 * opens nothing: the embedder, OCR sessions and the helper start on first use.
 */
import type {
  AsyncResult,
  BackgroundModels,
  ComputeFallbackEvent,
  SettingsStore,
  VectorIndex,
} from '@taalcut/core';
import type { DecodeProfile, DecodeService, FrameCache, MediaContext } from '@taalcut/media';
import type { ModelClient, ModelSelector } from '@taalcut/models';
import type { Tier } from '../config';
import type { VisionRuntime } from '../describe/placement';
import type { ShotBoundaryModel } from '../cuts/transnet';
import type { VisionEmbedder } from '../embed/embedder';
import type { LookJobDeps } from '../look/grade-jobs';
import type { OcrEngine } from '../ocr/types';

export interface VisionJobDeps {
  readonly media: MediaContext;
  /** The hardware tier (PRD G14): frames per shot, the soft-cut scan rate, the local describer. */
  readonly tier: Tier;
  /** EmbeddingGemma 2. Absent: no embeddings; shot and cut checks fall back to scdet alone. */
  readonly embedder?: VisionEmbedder;
  /**
   * The shot-boundary model (TransNetV2, IX2-C4), opened from its component on first use. Absent or failing:
   * shots by scdet and the embedding check, logged through `onFallback`.
   */
  readonly boundaryModel?: (signal?: AbortSignal) => AsyncResult<ShotBoundaryModel>;
  /** The active space's index (core's EmbeddingIndexToken). */
  readonly index?: VectorIndex;
  /** The routed OCR engine. Absent: no on-screen text. */
  readonly ocr?: OcrEngine;
  /**
   * The agent's models over main (core's BackgroundModels): how the jobs process describes shots.
   * Takes precedence over `models`. With neither, descriptions are skipped (`not_yet`).
   */
  readonly background?: BackgroundModels;
  /**
   * The component of the on-device model that describes on this Mac's tier (LIB1-FIX). A description on this Mac
   * that answers `not_yet` (the runtime is paused for an export, or still starting) then fails as
   * `vision.model_missing` naming it, so the library holds the stage and tries it again by itself instead of storing
   * a description that never comes. Absent: `not_yet` is stored as the stage's answer, as before.
   */
  readonly describeComponent?: string;
  /** The vision module's models in this process, for descriptions (tests, or a process with a model client). */
  readonly models?: {
    readonly client: ModelClient;
    readonly selector: ModelSelector;
    readonly runtime: VisionRuntime;
  };
  /** Standing upload consents (core's UPLOAD_CONSENTS_SETTING). Absent: never uploads. */
  readonly settings?: SettingsStore;
  /** A folder for short-lived frame files (the mac helper must be allowed to read it). */
  readonly tempDir: string;
  /**
   * The jobs process's per-asset frame cache (IX-D2): the shots stage's one decode leaves the analysis and
   * the OCR frames for the later stages. Absent: each job decodes for itself into `tempDir`.
   */
  readonly frameCache?: FrameCache;
  /** The hardware profile's video decoder, for decode routes the plan can't name (Windows). */
  readonly decodeProfile?: DecodeProfile;
  /**
   * Decodes in a process of its own (IX2-V3, IX2-G3: the mac helper's VideoToolbox decode): the frame reads, and the
   * analysis pass when switched on, as its `tasks` say (IX2-F14, media's `openDecodeService`). Absent: FFmpeg
   * decodes everything.
   */
  readonly decodeService?: DecodeService;
  /**
   * Segments of one long video (10 min and up) the analysis pass may decode at once (IX-D7), from the video
   * class budget. Absent or 1: one pass.
   */
  readonly passParallel?: number;
  /** A derived file's path by its cache key (the proxy, for jobs told to read it). Absent: originals only. */
  readonly derivedPath?: (key: string) => string | undefined;
  /** Writes a contact sheet JPEG (`stills/…contact-sheet.v1.jpg`) into the media cache. */
  readonly storeSheet?: (key: string, body: Buffer) => AsyncResult<{ readonly bytes: number }>;
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
  /**
   * Frame sampler and grade-LUT cache for vision.measureLook and vision.bakeGrade.
   * Absent: those jobs answer vision.look_unavailable / vision.grade_failed.
   */
  readonly look?: LookJobDeps;
}
