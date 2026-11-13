// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A composition is built from layers (SPEC P3.1): each draws one kind of thing (visuals, text, captions, motion
 * graphics, the brand kit) and hands back its markup, its tc.css rules, its motion (GSAP tweens as data, SPEC G.2)
 * and the files it links.
 * compileComposition concatenates them in z-order. A new kind of thing on screen is a new layer, never a new
 * branch in the compiler. Layers are pure: the same context gives the same bytes.
 */
import type { CaptionTrack, ExportPreset, FrameRate, Rect, Result, Style } from '@taalcut/core';
import type { FrameSpan, RenderPlan } from '../plan/types';
import type { CaptionFontId, CompositionFonts } from '../types';
import { NO_MOTION, type MotionPart } from '../motion/motion-data';

/** z-index bands, so layers stack the same way in every composition. */
export const Z = {
  /** Visuals take 1…n in timeline order. */
  visualsBase: 1,
  /** The logo: above clips, below the flash, text, graphics and captions. */
  brand: 140,
  flash: 150,
  text: 180,
  graphics: 190,
  captions: 200,
  /** Always on, in a corner. */
  watermark: 210,
} as const;

/** A burnt-in caption cue as laid out: graphics keep clear of it. */
export interface CaptionBox {
  readonly id: string;
  readonly span: FrameSpan;
  /** Canvas pixels, origin top left. */
  readonly box: Rect;
}

export interface LayerContext {
  readonly plan: RenderPlan;
  readonly variant: 'export' | 'preview';
  readonly preset: ExportPreset;
  /** The output canvas (the preset's), in pixels. */
  readonly width: number;
  readonly height: number;
  /** Text and graphics stay inside it. */
  readonly safe: Rect;
  readonly rate: FrameRate;
  /** Burnt-in captions or null. */
  readonly captions: CaptionTrack | null;
  readonly captionBoxes: readonly CaptionBox[];
  /** The resolved Style (timeline's, else the template version's), or null. */
  readonly style: Style | null;
  readonly fonts?: CompositionFonts;
  /** FRM1-OVL: heads on the canvas over their frames; graphics keep out of them. */
  readonly keepOut?: readonly { readonly span: FrameSpan; readonly box: Rect }[];
}

/** A bundle file: hard-linked from `source`, hashed by `key`. */
export interface LayerLink {
  readonly source: string;
  readonly key: string;
}

export interface LayerOutput {
  /** Elements, in stacking order within the layer. */
  readonly markup: readonly string[];
  /** tc.css rules (no inline styles: the preview CSP allows style-src 'self' only). */
  readonly css: readonly string[];
  /** Tweens and splits for tc.js's one GSAP timeline. */
  readonly motion: MotionPart;
  /** Files linked into the bundle, by bundle path. */
  readonly links: Readonly<Record<string, LayerLink>>;
  /** Curated fonts the layer draws with (their faces join the bundle). */
  readonly fonts: readonly CaptionFontId[];
  /** Non-fatal notes for the export's warnings. */
  readonly warnings: readonly string[];
}

export interface CompositionLayer {
  readonly id: string;
  build(context: LayerContext): Result<LayerOutput>;
}

export const EMPTY_LAYER: LayerOutput = {
  markup: [],
  css: [],
  motion: NO_MOTION,
  links: {},
  fonts: [],
  warnings: [],
};

/** A layer output with only the parts given. */
export function layerOutput(parts: Partial<LayerOutput>): LayerOutput {
  return { ...EMPTY_LAYER, ...parts };
}
