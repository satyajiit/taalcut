// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The seams inside the package: text measurement and fonts (captions), the
 * DOM probe (capture sessions), and the QA plan the compiler hands to QA.
 * Each side is tested against these shapes alone.
 */
import type { Box, CAPTION_FONTS, MusicPath, Rect } from '@taalcut/core';
import type { FrameSpan } from './plan/types';

export type CaptionFontId = (typeof CAPTION_FONTS)[number];

/** One shaped run: advance width and the font's ascent and descent at that size, in canvas pixels. */
export interface TextMeasure {
  readonly width: number;
  readonly ascent: number;
  readonly descent: number;
}

/** harfbuzzjs over the bundled fonts (createTextMeasurer); a first guess that the DOM probe confirms. */
export interface TextMeasurer {
  measure(text: string, font: CaptionFontId, weight: number, sizePx: number): TextMeasure;
}

/** One @font-face the composition links: a bundled file under `fonts/`. */
export interface FontFaceFile {
  /** CSS family name, e.g. 'Noto Sans Devanagari'. */
  readonly family: string;
  /** File name in the font directory, e.g. 'NotoSansDevanagari[wdth,wght].ttf'. */
  readonly file: string;
  /** CSS font-weight: '400', or a range for variable fonts: '100 900'. */
  readonly weight: string;
  readonly sha256: string;
}

/** The fonts a composition may use, from the font directory the engine resolved. */
export interface CompositionFonts {
  /** Absolute directory of the bundled font files (component install or development cache). */
  readonly dir: string;
  readonly measurer: TextMeasurer;
  /** CSS family stack for a curated font, ending in the Noto fallbacks. */
  stack(font: CaptionFontId): readonly string[];
  /** The @font-face files a set of fonts needs (their own and every fallback). */
  faces(fonts: readonly CaptionFontId[]): readonly FontFaceFile[];
}

/**
 * The pop highlight's motion room in a laid-out cue (captions/pop.ts): how far each word's pop pushes the other
 * words of its line apart, and the lead kept over every line for a popped word's rise.
 */
export interface PopRoom {
  /** One per word of the cue, in order, pixels each way. */
  readonly push: readonly number[];
  readonly leadPx: number;
}

/** How a caption cue sits on the canvas: its wrapped lines and its box, clamped into the safe rect. */
export interface CueLayout {
  readonly lines: readonly string[];
  /** How many of the cue's words each line holds, in order: the compiler breaks the lines exactly there. */
  readonly lineWords: readonly number[];
  readonly widthPx: number;
  readonly heightPx: number;
  /** Top of the block on the canvas, pixels. */
  readonly topPx: number;
  /** Measured line height (fonts' ascent + descent); the compiler draws lines at exactly this. */
  readonly lineHeightPx?: number;
  /** With the pop highlight: the room its motion needs, which the compiler draws and animates. */
  readonly pop?: PopRoom;
}

/** What the DOM probe reads for one visible text element at a frame (qa-gate.md, "DOM probe"). */
export interface ProbedTextBox {
  /** 'graphic' (HFW1): a composition graphic, its box what it draws (engine/dom-probe.ts). */
  readonly kind: 'caption' | 'text' | 'graphic';
  /** Cue id, text item id or graphic item id. */
  readonly id: string;
  readonly frame: number;
  /** getBoundingClientRect grown by stroke and background padding, rounded outward, canvas pixels. */
  readonly box: Rect;
  /** Distinct line tops from Range.getClientRects(). */
  readonly lines: number;
  /** scrollWidth > clientWidth. */
  readonly overflow: boolean;
  /** document.fonts.check for the element's font and text. */
  readonly fontsReady: boolean;
  /** The CSS text colour, '#rrggbb'. */
  readonly color: string;
  /** Graphics: the smallest font size among its visible text, canvas pixels. */
  readonly minFontPx?: number;
  /** Graphics: the CSS font-family of that smallest text (its cap height judges the type floor). */
  readonly minFontFamily?: string;
  /** Authored films: words alone, excluding intentional full-canvas scenery. */
  readonly textBounds?: Rect;
  readonly program?: true;
  /** Captions: every word as drawn at this frame, in order (captionOverflow's collision check). */
  readonly words?: readonly ProbedWord[];
}

/**
 * One caption word at a probed frame: its envelope (the word's box with its transform, one line tall,
 * widened by its scaled stroke on each side) and its scale (1 at rest, up to POP_SCALE in a pop).
 */
export interface ProbedWord {
  readonly box: Rect;
  readonly scale: number;
}

/** What the DOM probe reads of one visual element at a frame (P3-V2: the crop as Chrome applied it). */
export interface ProbedVisual {
  /** The plan's visual id. */
  readonly id: string;
  readonly frame: number;
  /** Computed `object-position`, e.g. '37.5% 50%'. */
  readonly objectPosition: string;
  /** Native region media and clipping viewport, measured by Chrome. */
  readonly box?: Rect;
  readonly viewport?: Rect;
  readonly clipPath?: string;
  /** Computed `scale` ('none' or a number). */
  readonly scale: string;
  /** Computed `transform-origin` in pixels, e.g. '540px 960px'. */
  readonly transformOrigin: string;
  readonly opacity: number;
}

/** A source the render's sound is compared with (avSync windows). */
export interface QaAudioWindow {
  /** Plan id: a clip id, 'music' or 'reference'. */
  readonly sourceId: string;
  readonly kind: 'clip' | 'music' | 'reference';
  /** Where the window starts on the render. */
  readonly startFrame: number;
  readonly frames: number;
}

/** What the compiler knows the render should contain (qa-gate.md, "Intended ranges"). */
export interface QaPlan {
  readonly version: 1;
  readonly rateNum: number;
  readonly rateDen: number;
  readonly durationFrames: number;
  readonly width: number;
  readonly height: number;
  /** Hard cuts (no transition), with the beat they should sit on when anchored. */
  readonly cuts: readonly {
    readonly frame: number;
    readonly from: string;
    readonly to: string;
    readonly beat: { readonly beatIndex: number; readonly frame: number } | null;
  }[];
  /** Every clip boundary with a beat anchor, transitions included. */
  readonly anchors: readonly {
    readonly clipId: string;
    readonly frame: number;
    readonly beatFrame: number;
  }[];
  /** Gaps, disabled clips and dip transitions. */
  readonly intendedDark: readonly FrameSpan[];
  /** Stills, holds and gaps. */
  readonly intendedStatic: readonly FrameSpan[];
  /** V1 clips by their cut, to name a finding's clip. */
  readonly clips: readonly {
    readonly id: string;
    readonly span: FrameSpan;
    readonly fit: 'cover' | 'contain';
  }[];
  readonly cues: readonly {
    readonly id: string;
    readonly span: FrameSpan;
    readonly probeFrames: readonly number[];
  }[];
  readonly texts: readonly {
    readonly id: string;
    readonly span: FrameSpan;
    readonly probeFrame: number;
    /** FIX-QA: the timeline item's own box and alignment, for captionSafeZone's ready move; absent when refitted. */
    readonly box?: Box;
    readonly align?: 'left' | 'center' | 'right';
  }[];
  /** HFW1: the graphics drawn with a composition (absent: none), for the graphics checks (qa/modules/graphics.ts). */
  readonly graphics?: readonly QaGraphic[];
  readonly audio: {
    /** Path a with no clip sound kept: the file carries a silent track on purpose. */
    readonly silent: boolean;
    readonly music: MusicPath;
    /** True when the mix includes the reference's own audio (path d only). */
    readonly referenceAudio: boolean;
    readonly windows: readonly QaAudioWindow[];
  };
}

/** HFW1: a composition graphic as QA measures it: its item, its frames and what draws it (its measurement's key). */
export interface QaGraphic {
  /** An authored chapter probes its containing continuous program. */
  readonly programItemId?: string;
  readonly id: string;
  readonly span: FrameSpan;
  readonly compositionId: string;
  /** The composition's sha256: with the params, the canvas and the length, what the graphic draws. */
  readonly hash: string;
  readonly params: Readonly<Record<string, string | number | boolean>>;
}
