// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** What the export knows that Phase 3's checks read (each absent when that feature isn't in the render). */
import type {
  AsyncResult,
  DuckingSettings,
  JobId,
  Rect,
  RenderListening,
  SoundCritiqueProfile,
  SoundListener,
  Style,
  TemplateListening,
  VoiceOverMusicReport,
} from '@taalcut/core';
import type { AiInventory, C2paReadSummary } from '../../credentials';
import type { FrameSpan, PlannedBumpers } from '../../plan/types';
import type { LayoutClip } from '../checks/visual-layout';
import type { ReframedClip } from '../checks/reframe';
import type { SlotMatchFact } from '../checks/slot-match/facts';
import type { StylePacingFact } from '../checks/style-pacing';

export interface QaFacts {
  /** P3-V2: every reframed clip with its framing, source size and the extent its element shows. */
  readonly reframe?: {
    readonly clips: readonly ReframedClip[];
    readonly layouts?: readonly LayoutClip[];
    /** Frames where transitions move or zoom visuals. */
    readonly transitions: readonly FrameSpan[];
  };
  /**
   * FRM1-OVL: heads on the canvas around each output frame, for every video clip (not only reframed ones), and
   * how many clips had a track to read them from.
   */
  readonly heads?: {
    at(frame: number): Rect[];
    readonly clips: number;
    readonly tracked: number;
  };
  /** P3-V6: the mix's voice-over-music report (null: nothing to compare) and the timeline's ducking settings. */
  readonly voiceOverMusic?: {
    readonly report: VoiceOverMusicReport | null;
    readonly settings: DuckingSettings;
  };
  /** P3-V7: the option, the AI inventory, and a reader of the delivered file. */
  readonly credentials?: {
    readonly add: boolean;
    readonly inventory: AiInventory;
    readonly inspect: (path: string) => Promise<C2paReadSummary | null>;
  };
  /** P3-V10: the Style drawn and where its bumpers sit. */
  readonly brand?: {
    readonly style: Style;
    readonly bumpers: PlannedBumpers;
    /** Logo files that were on disk (by sha256). */
    readonly assetsPresent: ReadonlySet<string>;
    readonly safe: Rect;
  };
  /** LRN1-STY: the pacing band of the set the project is made like, and the render's shots. */
  readonly stylePacing?: StylePacingFact;
  /** AGT2-MATCH: each template slot and reel graphic of a draft made from a template. */
  readonly slotMatch?: SlotMatchFact;
  /** EAR1-A2: who hears the render (audio's analysis job) and what its sound is judged against. */
  readonly listening?: SoundListeningFact;
}

/**
 * EAR1-R4: a sound effect on the render (where it plays, render frames) and, when its clip records one (its
 * `syncPoint`), the render frame it was placed to land on.
 */
export interface PlannedEffect extends FrameSpan {
  readonly anchor?: number;
}

/** A cut the listener hears: its render frame and the clip it cuts to. */
export interface HeardCut {
  readonly frame: number;
  readonly to: string;
}

/** EAR1-A2: the sound checks' facts (qa/modules/sound-listening.ts). */
export interface SoundListeningFact {
  readonly listener: SoundListener;
  /** `reference` when the draft follows a template whose reel was heard; else the launch films. */
  readonly profile: SoundCritiqueProfile;
  readonly reference?: TemplateListening;
  /** The export's job: the analysis runs as its child, in the 'gpu' slot the export holds. */
  readonly parentJobId?: JobId;
  /** The timeline's sound effects: each is judged on the cut it was placed for, and its clicks are its own. */
  readonly effects: readonly PlannedEffect[];
  /**
   * EAR1-R4: the cuts drawn with a transition (whip, zoom, flash…), which the plan's hard cuts leave out: one an
   * effect was placed for is heard and judged too.
   */
  readonly transitionCuts?: readonly HeardCut[];
  /**
   * The hearing the export started as soon as the file was finished, so it runs beside QA's other passes (in the
   * jobs process); handed out once, for that file. Undefined: hear it now.
   */
  readonly prefetched?: (file: string) => AsyncResult<RenderListening> | undefined;
  /**
   * EAR1-R4: aborts that hearing if no QA run took it. runQa calls it as it returns: after the first run a fix may
   * rewrite the file, and a cancelled or failed run never reads it.
   */
  readonly dropPrefetch?: () => void;
}
