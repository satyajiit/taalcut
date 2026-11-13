// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the placement solver (FRM1-OVL) takes and returns. Everything is in the made canvas's pixels and the
 * timeline's frames, so the solver is plain geometry: place-timeline.ts turns a timeline, its template and its
 * clips' subject spans into these, and the solver's boxes back into the items' `box` and `placement`.
 */
import type { OverlayPlacement, PlacementReason } from '@taalcut/core';
import type { Rect, Size, Span } from './geometry';

/** Where people are on the canvas at one frame of the timeline (one detect sample, mapped through its clip). */
export interface SceneFrame {
  readonly frame: number;
  /** Whole heads, hair included: the hard keep-out. */
  readonly heads: readonly Rect[];
  /** Whole people: a soft cost to cover. */
  readonly people: readonly Rect[];
  /** Salient regions (the busy part of the picture): a soft cost behind text. */
  readonly salient: readonly Rect[];
  /** The share (0–1) of a canvas rect the person silhouette covers, when the track has one. */
  readonly silhouette?: (rect: Rect) => number;
  /** The frames its clip is on screen: a span outside them never sees it, however near the cut. */
  readonly visible?: Span;
}

/** Something already on screen for a span: a caption cue, an item the person placed, another item. */
export interface Obstacle {
  readonly span: Span;
  readonly box: Rect;
}

export interface ChatRole {
  readonly tail: 'left' | 'right' | 'none';
  /** Bubbles of one conversation share an id; their order and columns stay as the reel's. */
  readonly conversation: number;
}

export interface PlacementItem {
  readonly id: string;
  readonly span: Span;
  /** The whole item's footprint at `scale` (1: the reel's size kept in pixels); never below `minScale`. */
  readonly sizeAt: (scale: number) => Size;
  readonly minScale: number;
  /** The reel's intent. */
  readonly relation: OverlayPlacement;
  /** The reel's box laid on the made canvas, same centre share (fit-layout.ts): the target of a frame relation. */
  readonly reel: Rect;
  readonly chat?: ChatRole;
  /** Words sit on the picture (no panel), so a busy background behind them costs more. */
  readonly onPicture: boolean;
}

export interface Scene {
  readonly canvas: Size;
  /** Where items may sit (the made frame's safe area), pixels. */
  readonly safe: Rect;
  /** The subject frames over a span (with a sample's margin either side), in time order. */
  frames(span: Span): readonly SceneFrame[];
  readonly obstacles: readonly Obstacle[];
}

export interface Placed {
  readonly id: string;
  readonly box: Rect;
  readonly scale: number;
  /** asReel, moved, shrunk or noRoom: the solver's own; retimed and recast come from place-timeline.ts. */
  readonly reason: Extract<PlacementReason, 'asReel' | 'moved' | 'shrunk' | 'noRoom'>;
  /** The side of the main head it ended on, or null with no head (for the reel-relation bar). */
  readonly side: OverlayPlacement['side'] | null;
  readonly cost: number;
}

export interface SolverConfig {
  /** Kept round every head, as a share of its height, at least `headMarginPx` and at most `headMarginMaxPx`. */
  readonly headMargin: number;
  readonly headMarginPx: number;
  readonly headMarginMaxPx: number;
  /** Kept between items, and between an item and a caption. */
  readonly itemGapPx: number;
  /** Shrink steps tried before an item has no room. */
  readonly shrinkSteps: readonly number[];
  /** Grid steps across the safe area. */
  readonly columns: number;
  readonly rows: number;
  /** Two bubbles this close in time (frames) are one conversation. */
  readonly conversationGapFrames: number;
  readonly weights: {
    readonly side: number;
    readonly distance: number;
    readonly zone: number;
    readonly body: number;
    readonly busy: number;
    readonly order: number;
    readonly column: number;
  };
}
