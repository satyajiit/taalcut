// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B8: what GapFixView shows. The gapFix card's gaps fit as they are; the editor's "Fix this gap" builds the
 * same shape from `timelines.gaps`, where a generated image has no estimate yet (the chat works it out).
 */
import type {
  AssetId,
  CardOf,
  GapBorrowCandidate,
  GapFixKind,
  GapReuseCandidate,
  GapSwapCandidate,
  GapView,
  GapWeakPick,
  Money,
  Result,
  StockResult,
  TimelineItemId,
} from '@taalcut/core';

type CardGap = CardOf<'gapFix'>['gaps'][number];
export type GapFixReason = CardGap['unavailable'][number]['reason'];

/** A fix as the view offers it; a generate without its model and estimate asks the chat for them. */
export type GapFixOptionView =
  | { readonly kind: 'film' }
  | {
      readonly kind: 'generate';
      readonly provider: string | null;
      readonly model: string | null;
      readonly estimate: Money | null;
      readonly prompt: string | null;
    }
  | { readonly kind: 'stock'; readonly query: string }
  | { readonly kind: 'drop'; readonly newDuration: GapView['duration'] }
  /** FIX-GAPS, a weak pick: its next-best clips, best fit first; and keeping the clip it has. */
  | { readonly kind: 'swap'; readonly candidates: readonly GapSwapCandidate[] }
  | { readonly kind: 'keep' }
  /** FIX-ASK: add clips for this video; the clip another shot has (and what it gets instead); another part of a clip. */
  | { readonly kind: 'addClips' }
  | { readonly kind: 'borrow'; readonly candidates: readonly GapBorrowCandidate[] }
  | { readonly kind: 'reuse'; readonly candidates: readonly GapReuseCandidate[] };

/**
 * One gap. `gone`: the timeline moved on and this gap isn't in it any more ("Already fixed"). `via` says what
 * filled it when the view knows (a stock video used here, an image on the clip).
 */
export interface GapFixItem extends GapView {
  readonly options: readonly GapFixOptionView[];
  readonly unavailable: readonly { readonly kind: GapFixKind; readonly reason: GapFixReason }[];
  readonly outcome: 'open' | 'filled' | 'dropped' | 'gone' | 'swapped' | 'kept' | 'borrowed' | 'reused';
  readonly via?: 'stock' | 'image' | 'video';
  /** FIX-GAPS: the slot has a clip casting is unsure of: that clip, and whether another clearly fits better. */
  readonly weak?: GapWeakPick;
  /** FIX-ASK: what the shot asks for, made short; the clip that comes closest; the template's text or graphics on it. */
  readonly wants?: string | null;
  readonly closest?: CardGap['closest'];
  readonly carries?: CardGap['carries'];
  /** FIX-ASK: the fix Taalcut proposes; the asking card starts with it chosen. */
  readonly proposed?: CardGap['proposed'];
}

/** FIX-GAPS: the media a swap puts in. */
export type SwapChoice = Pick<GapSwapCandidate, 'assetId' | 'shotId'>;

/** A fix chosen for one gap; a swap names its clip. */
export interface GapFixPick {
  readonly fix: GapFixKind;
  readonly swapTo?: SwapChoice;
}

export type StockQuery = {
  readonly query: string;
  readonly kind: 'video';
  readonly orientation?: 'portrait' | 'landscape' | 'square';
};

/** What the person can do with each fix; a missing handler hides that fix's action. */
export interface GapFixHandlers {
  /** Film this: the phone page's shot list. */
  readonly onFilm?: (gap: GapFixItem) => void;
  /** Generate an image, after the run: the request goes to the chat's composer, unsent. */
  readonly onGenerate?: (gap: GapFixItem) => void;
  /** Stock search for a gap's query. */
  readonly onStockSearch?: (query: StockQuery) => Promise<Result<{ readonly items: readonly StockResult[] }>>;
  /** Imports a stock result and fills the gap with it; resolves when the gap is filled. */
  readonly onStockUse?: (
    gap: GapFixItem,
    item: StockResult,
  ) => Promise<Result<{ readonly assetId: AssetId }>>;
  /** Drops the slot with a ripple; resolves with the command's result. */
  readonly onDrop?: (gap: GapFixItem) => Promise<Result<unknown>>;
  /** Opens the settings page that clears an unavailable fix's reason. */
  readonly onSettings?: (section: 'accounts' | 'models' | 'privacy' | 'usage') => void;
  /** FIX-ASK, Add more clips: a folder of clips from this Mac (the library's import); resolves when it is added. */
  readonly onAddFolder?: () => Promise<Result<unknown>>;
  /** FIX-ASK, Add more clips: the phone page, to send clips over Wi-Fi. */
  readonly onPhone?: () => void;
}

/** While the agent asks: each gap's chosen fix, ticked into the answer. */
export interface GapFixChoice {
  readonly chosen: ReadonlyMap<TimelineItemId, GapFixPick>;
  readonly onChoose: (gapId: TimelineItemId, pick: GapFixPick | null) => void;
  /** The answer went: the choices stay as they were, read only. */
  readonly locked: boolean;
}
