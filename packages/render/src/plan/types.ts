// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A timeline flattened for rendering: every visible thing as a half-open
 * frame span at the output rate. `planTimeline` builds it once; the
 * compiler, the audio mixer, captions and QA all read this instead of
 * walking the OTIO-shaped document again.
 */
import type {
  AssetId,
  BeatMap,
  Box,
  CaptionTrack,
  ClipReframe,
  ClipVisualLayout,
  AuthoredProgram,
  FrameRate,
  FrameSpan,
  GraphicComposition,
  Grade,
  MusicBed,
  MusicChoice,
  ProjectId,
  RationalTime,
  SpeedRamp,
  StillMotion,
  TimelineId,
  TEXT_REVEALS,
  TEXT_ROLES,
} from '@taalcut/core';

/** Frames [start, end) on the render: core's span, which `mergeSpans` and the other span helpers take. */
export type { FrameSpan } from '@taalcut/core';

/** The transition effects the composition can draw (SPEC section 3). */
export const TRANSITION_EFFECTS = [
  'cut',
  'crossfade',
  'dipToBlack',
  'dipToWhite',
  'slideLeft',
  'slideRight',
  'slideUp',
  'slideDown',
  'zoomIn',
  'zoomOut',
  'whipPan',
  'flash',
] as const;
export type TransitionEffect = (typeof TRANSITION_EFFECTS)[number];

export interface PlannedVisual {
  /** The timeline item id. */
  readonly id: string;
  readonly kind: 'video' | 'image';
  readonly assetId: AssetId;
  /** The clip's own place on the timeline, without transition handles. */
  readonly cut: FrameSpan;
  /** What is on screen: the cut grown by the transitions' handles. */
  readonly visible: FrameSpan;
  /** Source time shown at `visible.start` (the media's rate; zero for images). */
  readonly sourceIn: RationalTime;
  /** Source time shown at `cut.start`. */
  readonly sourceAtCut: RationalTime;
  /** Explicit editable hold: source time is constant throughout the clip and its handles. */
  readonly holdFrame?: RationalTime;
  readonly speed: SpeedRamp | null;
  /**
   * Source seconds consumed per timeline second, averaged over the clip: preview's playback rate only.
   * The export follows the exact curve of `speed` (speed-curve.ts).
   */
  readonly meanSpeed: number;
  readonly fit: 'cover' | 'contain';
  /** A disabled clip is planned as black, like a gap. */
  readonly enabled: boolean;
  readonly slotId: string | null;
  /** The cut frame the beat map wants (beats[i] to the nearest frame, plus the offset). */
  readonly beat: { readonly beatIndex: number; readonly frame: number } | null;
  readonly audio: { readonly gainDb: number; readonly muted: boolean };
  /** Video clips (P3-V2): null keeps Phase 2's behaviour on the timeline's own canvas. */
  readonly reframe: ClipReframe | null;
  readonly visualLayout?: ClipVisualLayout;
  /** Stills (P3-B7): null is the default slow push. */
  readonly stillMotion: StillMotion | null;
  /** EDT1-OPS: its colour, in the order applied: the clip's own grade, then the whole video's. Absent: none. */
  readonly grades?: readonly Grade[];
}

export interface PlannedTransition {
  readonly id: string;
  readonly effect: TransitionEffect;
  /** The template kind it came from, for warnings and QA. */
  readonly kind: string;
  readonly from: string;
  readonly to: string;
  /** The cut point: the incoming clip's cut.start. */
  readonly cut: number;
  /** [cut − inOffset, cut + outOffset). */
  readonly span: FrameSpan;
}

export interface PlannedText {
  readonly id: string;
  readonly span: FrameSpan;
  /** Plain text; never markup. */
  readonly text: string;
  readonly role: (typeof TEXT_ROLES)[number];
  readonly box: Box;
  readonly sizeRatio: number;
  readonly align: 'left' | 'center' | 'right';
  readonly letterCase: 'upper' | 'lower' | 'mixed';
  readonly background: 'none' | 'box' | 'outline' | 'shadow';
  readonly reveal: (typeof TEXT_REVEALS)[number];
  readonly language: string | null;
  /** The Style's text look this item asks for (P3-V10). */
  readonly styleKey: string;
  /** A person's own text keeps its look over the Style's. */
  readonly origin: 'template' | 'editor' | 'user';
  /** Laid into the preset's safe rect for another canvas (adaptPlan): `box` is no longer the timeline item's. */
  readonly refitted?: true;
}

/** A Style's intro or outro text card (P3-V10), drawn by the brand layer over a V1 gap. */
export interface PlannedCard {
  readonly id: 'intro' | 'outro';
  readonly span: FrameSpan;
  /** Plain text, escaped when drawn. */
  readonly text: string;
  readonly background: 'primary' | 'secondary' | 'background';
}

/** Where the Style's bumpers sit on the render (P3-V10); the timeline runs between them. */
export interface PlannedBumpers {
  readonly intro: FrameSpan | null;
  readonly outro: FrameSpan | null;
  readonly cards: readonly PlannedCard[];
  /** Path a (platform sound): the intro was left out so the platform's sound starts at frame 0. */
  readonly introLeftOut: boolean;
  /** Bumper clips whose asset is gone, skipped (brandAssets warns). */
  readonly missing: readonly ('intro' | 'outro')[];
}

export const NO_BUMPERS: PlannedBumpers = {
  intro: null,
  outro: null,
  cards: [],
  introLeftOut: false,
  missing: [],
};

/** One stretch of sound from a clip on V1 or an audio track. */
export interface PlannedAudioClip {
  readonly id: string;
  readonly track: string;
  readonly assetId: AssetId;
  /** Where it sounds on the render. */
  readonly span: FrameSpan;
  /** Source time at span.start. */
  readonly sourceIn: RationalTime;
  readonly speed: SpeedRamp | null;
  /** Frames of span before the clip's cut (a transition's handle), played at real time (speed-curve.ts). */
  readonly lead: number;
  readonly meanSpeed: number;
  readonly gainDb: number;
  /** Frames of fade at each end: the longer of a transition's overlap and the clip's own fade (EDT1-OPS). */
  readonly fadeInFrames: number;
  readonly fadeOutFrames: number;
}

/** HFW1: a graphic drawn with a workspace composition: its item, frames, the timeline's copy and its values. */
export interface PlannedComposition {
  readonly itemId: string;
  readonly span: FrameSpan;
  readonly composition: GraphicComposition;
  readonly values: Readonly<Record<string, string | number | boolean>>;
}

export interface RenderPlan {
  readonly programs?: readonly {
    readonly itemId: string;
    readonly span: FrameSpan;
    readonly program: AuthoredProgram;
    readonly sourceStart: RationalTime;
  }[];
  readonly timelineId: TimelineId;
  readonly projectId: ProjectId;
  readonly revision: number;
  readonly name: string;
  readonly rate: FrameRate;
  readonly width: number;
  readonly height: number;
  readonly durationFrames: number;
  /** V1's clips in order. */
  readonly visuals: readonly PlannedVisual[];
  /** V1 gaps and disabled clips: intended black. */
  readonly gaps: readonly FrameSpan[];
  readonly transitions: readonly PlannedTransition[];
  readonly texts: readonly PlannedText[];
  /** HFW1: graphics drawn with a workspace composition, by start (absent: none). */
  readonly compositions?: readonly PlannedComposition[];
  /** Burned in when enabled; null when off or never built. */
  readonly captions: CaptionTrack | null;
  readonly audio: readonly PlannedAudioClip[];
  /** Explicit source speech, independent of cutaway pictures. Absent keeps the legacy visual transcript. */
  readonly speech?: readonly PlannedVisual[];
  readonly music: MusicChoice;
  /** EDT1-OPS: where the music sounds, its shift, fades and mute (core's MusicBed). Absent: all of it, as before. */
  readonly musicBed?: MusicBed;
  readonly beatMap: BeatMap | null;
  /** Non-fatal notes, e.g. a template transition drawn as a cut. */
  readonly warnings: readonly string[];
  /** The Style's intro and outro (NO_BUMPERS without them); music starts after the intro. */
  readonly bumpers: PlannedBumpers;
}
