// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** What compileComposition takes (SPEC section 3, P3.1); the layers read it too. */
import type { CaptionStyle, ExportPreset, Rect, Style } from '@taalcut/core';
import type { PlannedBumpers, PlannedVisual } from '../plan/types';
import type { FramingPlan } from '../reframe/framing-types';
import type { BrandAssetFile } from '../style/brand-layers';
import type { CompositionFonts, CueLayout } from '../types';
import type { WorkspaceReader } from '../workspace/fold/types';
import type { CompositionPlacement } from './layers/compositions';
import type { CompositionMediaEntry, CropStyle } from './layers/visuals';

/** Lays a caption cue's words out: wrapped lines and the clamped box (captions' layoutCue). */
export type CaptionLayout = (
  words: readonly string[],
  style: CaptionStyle,
  safe: Rect,
  language: string,
  canvasHeight: number,
) => CueLayout;

export interface CompileOptions {
  readonly variant: 'export' | 'preview';
  readonly preset: ExportPreset;
  readonly burnCaptions: boolean;
  readonly media: (visual: PlannedVisual) => CompositionMediaEntry | undefined;
  readonly fonts?: CompositionFonts;
  /** Wrapped lines and the clamped box of a cue (captions' layoutCue); a size-only estimate without it. */
  readonly captionLayout?: CaptionLayout;
  /** Preview: the mixed sound, played by one <audio>. */
  readonly audio?: { readonly file: string; readonly key: string };
  /** Preview: HyperFrames' runtime, which main serves (the producer's file server would inject it). */
  readonly runtimeScript?: { readonly file: string; readonly key: string };
  /** P3-V2: how each visual fills the canvas (absent: every visual by its fit). */
  readonly framing?: FramingPlan;
  /** P3-V2: draws a crop framing (reframe/keyframes.ts). */
  readonly cropStyle?: CropStyle;
  /** P3-V2: cue anchors moved off faces (caption dodging), by cue id. */
  readonly captionAnchors?: ReadonlyMap<string, number>;
  /** P3-V10: the resolved Style, its logo file and its bumpers; null or absent draws no brand. */
  readonly style?: Style | null;
  readonly brandAssets?: (sha256: string) => BrandAssetFile | undefined;
  /** P3-V10: where the Style's intro and outro sit (the timeline given already has them in place). */
  readonly bumpers?: PlannedBumpers;
  /** FRM1-OVL: heads on the canvas over their frames (engine/stages/heads.ts); graphics keep out of them. */
  readonly keepOut?: readonly {
    readonly span: { readonly start: number; readonly end: number };
    readonly box: Rect;
  }[];
  /**
   * HFW1: workspace compositions placed on the timeline, gated and lowered (compile/layers/compositions.ts); absent,
   * the plan's composition graphics, read from `workspace`.
   */
  readonly compositions?: readonly CompositionPlacement[];
  /** HFW1: the project's workspace blobs (workspace/fold/reader.ts); absent, composition graphics are left out. */
  readonly workspace?: WorkspaceReader;
  readonly authoredWorkspace?: WorkspaceReader;
}
