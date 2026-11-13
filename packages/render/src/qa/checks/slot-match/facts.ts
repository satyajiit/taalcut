// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: what QA's slot match knows of a draft made from a template (QaFacts.slotMatch), one entry per template
 * slot and per reel graphic, built by the export from the timeline, its template, the clips' subject tracks on the
 * canvas and the library's word on each shot (build.ts). Measurements only: the checks (slot-checks.ts,
 * slot-graphics.ts) hold them to the reel with the generic limits below.
 */
import type { AsyncResult, CameraMotion, INTENT_FACES, ProjectId, Template, Timeline } from '@taalcut/core';
import type { NeedVerdict, SlotShot } from '@taalcut/timeline';
import type { FrameSpan } from '../../../plan/types';
import type { OverlayBrief } from '../../../workspace/template/brief';

/** Shares of the canvas, origin top left. */
export interface ShareBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SlotFact {
  readonly slotId: string;
  /** From 1, in the template's order. */
  readonly number: number;
  /** What a finding targets: the slot's first clip (or gap) on V1, else the slot's own id when nothing fills it. */
  readonly target: string;
  /** The slot's first enabled clip; null when no clip fills it. */
  readonly clipId: string | null;
  /** The draft frames its clips cover, first cut to last; null when no clip fills it. */
  readonly span: FrameSpan | null;
  readonly reelSeconds: number;
  /** Its clips' cuts, summed (0 when none). */
  readonly draftSeconds: number;
  /** Its needs, each met when any of its clips meets it; empty when the slot states none or nothing was read. */
  readonly needs: readonly NeedVerdict[];
  readonly face: {
    /** The Analyst's word on the reel: shown, hidden, or no word. */
    readonly wanted: (typeof INTENT_FACES)[number] | null;
    /** Subject samples over its clips' cuts, and those showing a face (none: nothing could be read). */
    readonly samples: number;
    readonly shown: number;
  };
  readonly framing: {
    /** The reel's main head over the slot, and the draft's over its frames (medians); null when nobody shows. */
    readonly reel: ShareBox | null;
    readonly draft: ShareBox | null;
    /** The draft's clips had tracks to read heads from. */
    readonly measured: boolean;
  };
  readonly motion: {
    /** The slot's camera move (its intent, else its measure) and the shot's as the library measured it. */
    readonly reel: CameraMotion | null;
    readonly shot: CameraMotion | null;
  };
}

export interface SlotGraphicFact {
  readonly overlayId: string;
  readonly slotId: string | null;
  readonly number: number | null;
  /** Where and how big the reel had it, on the design canvas (HFW1's brief). */
  readonly brief: OverlayBrief;
  /** The draft's graphic drawing it; null when none does. */
  readonly itemId: string | null;
  readonly span: FrameSpan | null;
  /** The frame its box is read at (the middle of its time); null without a graphic. */
  readonly hold: number | null;
  /** Its words' length over the reel's (reelMatch widens the band for longer words). */
  readonly wordsRatio: number;
}

export interface SlotMatchFact {
  readonly canvas: { readonly width: number; readonly height: number };
  readonly slots: readonly SlotFact[];
  readonly graphics: readonly SlotGraphicFact[];
}

/** What the render root reads for a draft (RenderEngineDeps.slotMatch): the template it follows, each shot's word. */
export interface SlotMatchSourced {
  readonly template: Template;
  readonly shots: readonly SlotShot[];
}

/**
 * The render root's port: the template version a timeline follows and timeline's `slotShots` over the library's
 * profiles; null when the timeline follows no template. An error leaves the slot checks skipped, never the export.
 */
export type SlotMatchSource = (input: {
  readonly projectId: ProjectId;
  readonly timeline: Timeline;
  readonly signal?: AbortSignal;
}) => AsyncResult<SlotMatchSourced | null>;

/** Generic limits: how far a draft may sit from its reel before a slot fails. */
export const SLOT_MATCH = {
  /** A hidden face may show on this share of a slot's samples (a turn of the head); a shown one on at least this. */
  face: { hiddenMax: 0.1, shownMin: 0.5 },
  /** The main head's middle within these shares of the frame of the reel's, and its height within these ratios. */
  framing: { across: 0.15, down: 0.12, minSize: 0.6, maxSize: 1.67 },
  /** A slot's length within this share of the reel's, or this many seconds, whichever is more. */
  timing: { share: 0.2, seconds: 0.3 },
} as const;
