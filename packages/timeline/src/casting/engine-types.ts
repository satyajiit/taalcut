// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The casting engine's requests, results and port (engine.ts). */
import type {
  AsyncResult,
  Canvas,
  CastCandidate,
  CastId,
  Embedder,
  ProjectId,
  ShotId,
  ShotProfile,
  ShotProfileRef,
  SlotId,
  SourceId,
  Template,
} from '@taalcut/core';
import type { ShotCatalog } from './catalog';
import type { CastingConfig } from './config';
import type { HookVariantRequest } from './hook-variants';
import type { CastingConfigSource, CastingWeightsUsed } from './learned/config-source';
import type { CastVariant } from './result';
import type { LockedShot } from './template-pools';

export interface CastRequest {
  readonly projectId: ProjectId;
  readonly template: Template;
  readonly mode: 'template' | 'story';
  /** 1–10. */
  readonly variants: number;
  /** Reserved for sampled tie-breaks; casting is deterministic for one library state. */
  readonly seed: number;
  readonly pool?: {
    /** Story mode: the brief's words, searched in the library. */
    readonly query?: string;
    readonly capturedFrom?: number;
    readonly capturedTo?: number;
    readonly sourceIds?: readonly SourceId[];
  };
  readonly locked?: readonly LockedShot[];
  readonly exclude?: readonly ShotId[];
  /** The order a vision rerank gave a slot's five, best first. */
  readonly rerank?: readonly { readonly slotId: SlotId; readonly order: readonly ShotId[] }[];
  /**
   * The made video's size, when a person chose it. Absent: the template's, unless most picks have another
   * orientation (BRK1-MAKE, follow-canvas.ts).
   */
  readonly canvas?: { readonly width: number; readonly height: number };
}

export interface CastResult {
  readonly castId: CastId;
  /** The config version, `+learned@<updatedAt>` when the learned weights applied (LRN1-PREF). */
  readonly configVersion: string;
  /** LRN1-PREF: the five score weights this cast used and where they came from, so a replay is exact. */
  readonly weights: CastingWeightsUsed;
  readonly mode: 'template' | 'story';
  readonly variants: CastVariant[];
  /** Fewer variants than asked: the library can't make more that differ enough. */
  readonly variantsShort?: { readonly asked: number; readonly made: number };
  /** The canvas the slots were cast for, which the made video gets: the template's, the request's or the clips'. */
  readonly canvas: Canvas;
}

export interface AlternatesRequest {
  readonly template: Template;
  readonly slotId: SlotId;
  /** The clips either side, which the alternates are scored against. */
  readonly previous: { readonly assetId: string; readonly shotId: string | null } | null;
  readonly next: { readonly assetId: string; readonly shotId: string | null } | null;
  /** Candidate keys used elsewhere in the timeline, plus the current pick. */
  readonly used: readonly string[];
  readonly exclude: readonly ShotId[];
  readonly limit: number;
  /** The video's canvas, whose orientation the alternates match (BRK1-MAKE). Default: the template's. */
  readonly canvas?: { readonly width: number; readonly height: number };
}

export interface CastingEngine {
  readonly config: CastingConfig;
  cast(request: CastRequest, signal?: AbortSignal): AsyncResult<CastResult>;
  /** P3-V3: variants of an existing cut that differ from it (and each other) in the hook and ≥ 30% of picks. */
  hookVariants(request: HookVariantRequest, signal?: AbortSignal): AsyncResult<CastVariant[]>;
  /** "Find something else": fresh candidates for one slot given its neighbours. */
  alternates(request: AlternatesRequest, signal?: AbortSignal): AsyncResult<CastCandidate[]>;
  /** FIX-TRIM: the catalogue's profiles of these shots, for assembly's in-points with the person (absent: none). */
  profiles?(refs: readonly ShotProfileRef[], signal?: AbortSignal): AsyncResult<ShotProfile[]>;
}

export interface CastingEngineDeps {
  readonly catalog: ShotCatalog;
  readonly embedder: Embedder;
  readonly config?: CastingConfig;
  /** LRN1-PREF: each call's config (the defaults with the learned weights), resolved per call. Absent: `config`. */
  readonly configSource?: CastingConfigSource;
  readonly ids?: { cast(): CastId };
}
