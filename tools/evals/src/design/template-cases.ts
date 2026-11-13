// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * eval:design's template mode (HFW1 tpl): made-up reels for the template Designer. Each reel is a made-up footage
 * still with made-up graphics drawn over it, each a hand-written HyperFrames composition (src/fixtures/design/reel/,
 * never a kit), at its time; the reading's overlays are built from what those draws measure (template-reel.ts).
 * A kinetic title the reading would call plain text is not a graphic (timeline's `isGraphicOverlay`), so the
 * kinetic title here sits on a band of colour: a label. One reel is 16:9 (`chat-pair-wide`): it is drawn in the
 * canvas's top 608 px and cut to them, and its graphics are designed on the 9:16 canvas as the owner's 16:9 reels'
 * are. Words, names and colours are made up.
 */
import type { OverlayDesign } from '@taalcut/core';

export interface ReelOverlay {
  /** The fixture that draws it in the reel: `reel/<fixture>.html`, whose composition id is its name. */
  readonly fixture: string;
  readonly words: string;
  /** On and off, in reel frames at 30 fps. */
  readonly startFrame: number;
  readonly frames: number;
  /** The fixture's type size (px on 1080×1920), for the reading's cap height. */
  readonly fontPx: number;
  readonly design: Omit<OverlayDesign, 'shape' | 'confidence'>;
  /** Where the stand-in's draw says it sits (shares of the canvas) and its lines; a real draw measures both. */
  readonly standIn: StandInDraw;
  /**
   * What the stand-in Designer writes for it, when not its reel fixture: a 16:9 reel's graphic designed on the 9:16
   * canvas (`reel/<designFixture>.html`), and where the stand-in's draw says that sits.
   */
  readonly designFixture?: string;
  readonly designStandIn?: StandInDraw;
}

export interface StandInDraw {
  readonly box: { x: number; y: number; width: number; height: number };
  readonly lines: number;
}

export interface TemplateCase {
  readonly id: string;
  readonly about: string;
  /** The reel's length, frames at 30 fps. */
  readonly frames: number;
  /** A reel of another shape: its frame is the canvas's top `reelHeight` px, full width (16:9 is 608). */
  readonly reelHeight?: number;
  /** Each design is also held to the template Designer's own reel-match check (render's `reelMatch`). */
  readonly reelMatch?: boolean;
  readonly overlays: readonly ReelOverlay[];
}

const font = { class: 'sans', weight: 600 } as const;
const fade = { enter: 'fade', exit: 'fade', typing: false } as const;

export const TEMPLATE_CASES: readonly TemplateCase[] = [
  {
    id: 'chat-pair',
    about: 'A message and its reply, both on screen together',
    frames: 150,
    reelMatch: true,
    overlays: [
      {
        fixture: 'incoming',
        words: 'Are you coming tonight?',
        startFrame: 15,
        frames: 84,
        fontPx: 54,
        design: {
          kind: 'chatBubble',
          colors: { fill: '#ffffff', text: '#111111', stroke: null },
          cornerRadius: 0.4,
          tail: 'left',
          font,
          motion: { enter: 'pop', exit: 'fade', typing: false },
        },
        standIn: { box: { x: 0.074, y: 0.312, width: 0.62, height: 0.07 }, lines: 1 },
      },
      {
        fixture: 'outgoing',
        words: 'On my way!',
        startFrame: 45,
        frames: 75,
        fontPx: 54,
        design: {
          kind: 'chatBubble',
          colors: { fill: '#2f6df6', text: '#ffffff', stroke: null },
          cornerRadius: 0.4,
          tail: 'right',
          font,
          motion: { enter: 'pop', exit: 'fade', typing: false },
          receipt: true,
        },
        standIn: { box: { x: 0.6, y: 0.427, width: 0.326, height: 0.07 }, lines: 1 },
      },
    ],
  },
  {
    id: 'lower-third',
    about: 'A name on a dark band, low on the left',
    frames: 120,
    overlays: [
      {
        fixture: 'lower-third',
        words: 'Mira Shah, baker',
        startFrame: 30,
        frames: 84,
        fontPx: 58,
        design: {
          kind: 'lowerThird',
          colors: { fill: '#111111', text: '#ffffff', stroke: null },
          cornerRadius: 0.1,
          tail: 'none',
          font,
          motion: { enter: 'slide', exit: 'fade', typing: false },
        },
        standIn: { box: { x: 0.067, y: 0.708, width: 0.55, height: 0.066 }, lines: 1 },
      },
    ],
  },
  {
    id: 'kinetic-title',
    about: 'A big title popping in on a yellow band across the middle',
    frames: 120,
    overlays: [
      {
        fixture: 'title',
        words: 'Golden hour market',
        startFrame: 20,
        frames: 75,
        fontPx: 84,
        design: {
          kind: 'label',
          colors: { fill: '#ffd23f', text: '#111111', stroke: null },
          cornerRadius: 0.05,
          tail: 'none',
          font: { class: 'display', weight: 800 },
          motion: { enter: 'pop', exit: 'fade', typing: false },
        },
        standIn: { box: { x: 0.083, y: 0.427, width: 0.834, height: 0.09 }, lines: 1 },
      },
    ],
  },
  {
    id: 'pill-tag',
    about: 'A short tag in a red pill, high in the middle',
    frames: 120,
    overlays: [
      {
        fixture: 'pill',
        words: 'New recipe',
        startFrame: 15,
        frames: 75,
        fontPx: 54,
        design: {
          kind: 'pill',
          colors: { fill: '#e63946', text: '#ffffff', stroke: null },
          cornerRadius: 0.5,
          tail: 'none',
          font,
          motion: fade,
        },
        standIn: { box: { x: 0.33, y: 0.188, width: 0.34, height: 0.06 }, lines: 1 },
      },
    ],
  },
  {
    id: 'two-at-once',
    about: 'A label at the top and a follow button at the bottom, on together',
    frames: 150,
    overlays: [
      {
        fixture: 'day-label',
        words: 'Day 3 of 30',
        startFrame: 15,
        frames: 84,
        fontPx: 56,
        design: {
          kind: 'label',
          colors: { fill: '#000000', text: '#ffffff', stroke: null },
          cornerRadius: 0.15,
          tail: 'none',
          font,
          motion: fade,
        },
        standIn: { box: { x: 0.074, y: 0.156, width: 0.38, height: 0.064 }, lines: 1 },
      },
      {
        fixture: 'follow',
        words: 'Follow for more',
        startFrame: 30,
        frames: 75,
        fontPx: 56,
        design: {
          kind: 'cta',
          colors: { fill: '#22c55e', text: '#0b1b10', stroke: null },
          cornerRadius: 0.5,
          tail: 'none',
          font,
          motion: { enter: 'pop', exit: 'fade', typing: false },
        },
        standIn: { box: { x: 0.27, y: 0.77, width: 0.46, height: 0.066 }, lines: 1 },
      },
    ],
  },
  {
    id: 'chat-pair-wide',
    about: 'A 16:9 reel’s message and reply, designed for a 9:16 video',
    frames: 150,
    reelHeight: 608,
    reelMatch: true,
    overlays: [
      {
        fixture: 'incoming-wide',
        words: 'How was the trip?',
        startFrame: 15,
        frames: 84,
        fontPx: 30,
        design: {
          kind: 'chatBubble',
          colors: { fill: '#ffffff', text: '#111111', stroke: null },
          cornerRadius: 0.5,
          tail: 'left',
          font,
          motion: { enter: 'pop', exit: 'fade', typing: false },
        },
        standIn: { box: { x: 0.056, y: 0.078, width: 0.284, height: 0.0333 }, lines: 1 },
        designFixture: 'incoming-wide-design',
        designStandIn: { box: { x: 0.056, y: 0.2693, width: 0.512, height: 0.0598 }, lines: 1 },
      },
      {
        fixture: 'outgoing-wide',
        words: 'Long, but worth it',
        startFrame: 45,
        frames: 75,
        fontPx: 30,
        design: {
          kind: 'chatBubble',
          colors: { fill: '#2f6df6', text: '#ffffff', stroke: null },
          cornerRadius: 0.5,
          tail: 'right',
          font,
          motion: { enter: 'pop', exit: 'fade', typing: false },
          receipt: true,
        },
        standIn: { box: { x: 0.651, y: 0.1354, width: 0.2935, height: 0.0333 }, lines: 1 },
        designFixture: 'outgoing-wide-design',
        designStandIn: { box: { x: 0.4157, y: 0.4505, width: 0.5285, height: 0.0598 }, lines: 1 },
      },
    ],
  },
];

/** The cases with these ids (all of them when none are given). */
export function templateCases(ids: readonly string[] = []): TemplateCase[] {
  if (ids.length === 0) return [...TEMPLATE_CASES];
  return ids.map((id) => {
    const found = TEMPLATE_CASES.find((entry) => entry.id === id);
    if (!found) throw new Error(`No template case ${id}`);
    return found;
  });
}
