// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Gap handling's ports and shapes (SPEC section 26, P3-B8). A gap is a slot whose best pick is missing or
 * under the confidence floor after the rerank; the agent reads them through a GapSource (the desktop builds
 * it over the timeline service), proposes fixes (proposals.ts) and runs the `agent.gaps` skill to apply them.
 */
import type { AsyncResult, CastNote, GapFixKind, GapView, RationalTime } from '@taalcut/core';

/**
 * How a slot stands now: a hole, a weak pick, or a fix already in place. FIX-GAPS: `picked` is a clip casting is
 * sure of (or one a fix swapped in), listed so a swap shows in the stored timeline.
 */
export const GAP_SLOT_STATES = ['empty', 'weak', 'filled', 'dropped', 'picked'] as const;
export type GapSlotState = (typeof GAP_SLOT_STATES)[number];

/** FIX-GAPS: a shot a weak slot has or could take: its media, what indexing said it shows, its fit (0–1). */
export interface GapShot {
  readonly assetId: string;
  readonly shotId: string | null;
  readonly description: string | null;
  readonly fit: number;
}

/**
 * FIX-GAPS: a slot whose clip casting is unsure of (under the timeline lane's own line): the clip, the pick's
 * confidence, its next-best candidates best fit first (at most three), and the one that clearly fits better, if any.
 */
export interface WeakPickInfo {
  readonly pick: GapShot;
  readonly confidence: number;
  readonly candidates: readonly GapShot[];
  readonly better: GapShot | null;
}

/** The media a swap puts in a slot. */
export interface SwapTarget {
  readonly assetId: string;
  readonly shotId: string | null;
}

/** FIX-ASK: what a shot carries in the template besides its clip (core's GAP_CARRIES). */
export type GapCarry = 'text' | 'graphics';

/**
 * FIX-ASK: a clip another shot has now that could fill this one: how well it fits here (`fit`), whether it clears
 * casting's line here (`better`: casting's own fit-to-confidence rule, worked out by the composition root), the shot
 * that would give it up (its clip's id, number and how well the clip fits there) and the clip that shot gets instead
 * (this shot's own clip when it fits there, else the best clip no shot uses).
 */
export interface BorrowShot extends GapShot {
  readonly better: boolean;
  readonly from: {
    readonly gapId: string;
    readonly slotId: string | null;
    readonly number: number;
    readonly fit: number;
  };
  readonly instead: GapShot;
}

/** FIX-ASK: another part of a clip a shot already shows, long enough for two moments that don't overlap. */
export interface ReuseShot extends GapShot {
  readonly usedIn: number;
  readonly sourceStart: RationalTime;
}

/** FIX-ASK: the clips a gap could take from the rest of the video: another shot's, or another part of one. */
export interface GapOffers {
  readonly borrow: readonly BorrowShot[];
  readonly reuse: readonly ReuseShot[];
}

/** One slot that is (or was) a gap. */
export interface GapSlot {
  /** The gap's item on V1, or the weak clip's id: what a gapFix answer is keyed by. */
  readonly gapId: string;
  readonly slotId: string | null;
  /** 1-based, as the cast board numbers slots; 1 is the hook. */
  readonly number: number;
  readonly start: RationalTime;
  readonly duration: RationalTime;
  /** The slot's intent in plain words, when the template has one. */
  readonly intent: GapView['intent'];
  readonly state: GapSlotState;
  readonly note: CastNote | null;
  /** FIX-GAPS: state `weak` only. */
  readonly weak?: WeakPickInfo;
  /** FIX-GAPS: the media in the slot's clip now, when it has one. */
  readonly current?: SwapTarget;
  /** FIX-ASK: the template's text or graphics on this shot. */
  readonly carries?: readonly GapCarry[];
  /** FIX-ASK: an open gap's offers from the rest of the video, when the reader was asked for them. */
  readonly offers?: GapOffers;
}

/** A timeline's gaps as stored now. */
export interface GapTimeline {
  readonly timelineId: string;
  readonly projectId: string;
  readonly revision: number;
  readonly duration: RationalTime;
  /** The format's shortest length; null when the template names none. */
  readonly minDuration: RationalTime | null;
  /** Gaps and weak picks, and slots a gap fix already touched (filled, dropped, marked for filming). */
  readonly slots: readonly GapSlot[];
  /** FIX-ASK: the shots the video has (the cast's slots, dropped ones left out); absent: as many as `slots` lists. */
  readonly slotCount?: number;
}

export interface GapReadOptions {
  /** FIX-ASK: work out each open gap's offers too (the clips other shots have, other parts of used clips). */
  readonly offers?: boolean;
}

export interface GapSource {
  read(timelineId: string, signal?: AbortSignal, options?: GapReadOptions): AsyncResult<GapTimeline>;
}

/** FIX-ASK: clips added to the library since a time: how many, and how many are ready to cast (fully indexed). */
export interface AddedClips {
  readonly added: number;
  readonly ready: number;
}

/**
 * FIX-ASK: the person's new clips. `added` counts what came in since a time (from this Mac or the phone, through the
 * library's own import); `recast` casts a timeline's open gaps again with every ready clip, one undo step: an empty
 * shot takes its best clip no shot uses, an unsure one a clip that clearly fits better. It answers how many changed.
 */
export interface GapClips {
  added(since: number, signal?: AbortSignal): AsyncResult<AddedClips>;
  recast(
    timelineId: string,
    gapIds: readonly string[],
    signal?: AbortSignal,
  ): AsyncResult<{ readonly changed: number }>;
}

/**
 * Whether a still can be generated now, and what one costs (models' first available image route). A path
 * whose price isn't known isn't offered: the card would have to show it as free.
 */
export type ImagePath =
  | {
      readonly ok: true;
      readonly provider: string;
      readonly model: string;
      readonly usdPerImage: number;
      /** The price is token-based: the card says "about". */
      readonly estimated: boolean;
    }
  | { readonly ok: false; readonly reason: 'localOnly' | 'noImageModel' };

/** Whether stock search can run now (P3-V18): only when its tool is registered. */
export type StockPath =
  { readonly ok: true } | { readonly ok: false; readonly reason: 'localOnly' | 'stockOff' | 'noStockKey' };

/** What the gaps skill and its extension read. */
export interface GapsDeps {
  readonly source: GapSource;
  /** Absent: no image path is composed (the images module isn't there). Asks the providers, so async. */
  readonly images?: (signal?: AbortSignal) => Promise<ImagePath>;
  /** Absent: stock isn't shipped. */
  readonly stock?: () => StockPath;
  readonly localOnly?: () => boolean;
  /** FIX-ASK: absent, "Add more clips" isn't offered. */
  readonly clips?: GapClips;
  /** FIX-ASK: how long the step waits for added clips to be ready before it casts again, and how often it looks. */
  readonly clipWait?: { readonly maxMs: number; readonly everyMs: number };
}

/** One gap as the skill gets it: where it is, what it was meant to show, its fixes and the one to apply. */
export interface GapRow {
  readonly timelineId: string;
  readonly gapId: string;
  readonly slotId: string | null;
  readonly number: number;
  readonly state: 'empty' | 'weak';
  /** Plain text; empty when the template had none. */
  readonly intent: string;
  readonly fixes: readonly GapFixKind[];
  /** The fix to apply: the user's answer, else the default. */
  readonly fix: GapFixKind;
  /** generate: the prompt for the still. */
  readonly prompt?: string;
  /** stock: the search words. */
  readonly query?: string;
  /** FIX-GAPS, swap: the candidate to put in (timeline.swapClip). FIX-ASK: borrow and reuse too. */
  readonly swapTo?: SwapTarget;
  /** FIX-ASK, borrow: the clip that gives its media up (its item id) and what it gets instead. */
  readonly borrow?: { readonly clipId: string; readonly number: number; readonly instead: SwapTarget };
  /** FIX-ASK, reuse: where the part of the clip starts. */
  readonly sourceStart?: RationalTime;
  /** Why the default is what it is, model-facing (e.g. "the hook can't be dropped"). */
  readonly why?: string;
}
