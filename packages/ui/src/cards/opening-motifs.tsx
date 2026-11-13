// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: opening choice motifs · genre: atmospheric studio app (brand moment: the chat start)
 * system: DESIGN.md v0.4 (UX1: the chat start's ways in are choice tiles, each with a drawn motif in its accent)
 * decorative only (aria-hidden; the words carry the meaning): inline SVG on a 40 × 20 grid, shown at 48 × 24, in
 *   currentColor, which the tile sets to the way's accent -strong (ink-disabled when the way is off)
 *   library · three portrait clip frames, newest first and strongest; one bar: a new clip slides in at the front.
 *     Hollow (nothing in the library yet): the frames are empty outlines; one bar: a first clip drops into the front
 *   reference · a waveform whose downbeats stand taller; one bar: the reel is read, each bar rising to full height
 *   template · a strip of empty slots of differing widths; one bar: a clip drops into each slot
 *   describe · lines of words, the first written; one bar: the rest are written, word by word
 * motion: rest ↔ play, transform and opacity only, 40 ms apart on --dur-short / --ease-out; play leaves in reverse.
 *   The tile chooses when (hover, focus, open); under reduced motion it never plays, so the drawing stays still
 * states: rest · play (hover, focus, open) · disabled (the tile's ink-disabled, never plays) · hollow (library only)
 */
import type { OpeningPath } from '@taalcut/core';
import { motion, type TargetAndTransition, type Variants } from 'motion/react';
import type { ComponentType } from 'react';
import { DUR, EASE_OUT } from '../lib/motion';

/** Seconds between one part's move and the next. */
const STEP = 0.04;

interface Part {
  readonly i: number;
  readonly n: number;
}

/**
 * A part's two poses. Play runs the parts first to last; rest runs them back last to first, so leaving a tile
 * plays the bar in reverse.
 */
function poses(rest: TargetAndTransition, play: TargetAndTransition): Variants {
  return {
    rest: ({ i, n }: Part) => ({
      ...rest,
      transition: { duration: DUR.short, ease: EASE_OUT, delay: (n - 1 - i) * STEP },
    }),
    play: ({ i }: Part) => ({
      ...play,
      transition: { duration: DUR.short, ease: EASE_OUT, delay: i * STEP },
    }),
  };
}

// Drawn on a 40 × 20 grid, shown at 48 × 24: a glyph with presence beside the tile's 14 px name.
const SVG = { width: 48, height: 24, viewBox: '0 0 40 20', fill: 'currentColor' } as const;

// Library: portrait frames (short-form video is 9:16), 12 units apart; older ones fainter.
const FRAME = { width: 9, height: 16, y: 2, rx: 2 } as const;
const FRAMES: readonly Variants[] = [
  poses({ x: -6, opacity: 0 }, { x: 0, opacity: 1 }),
  poses({ x: 0, opacity: 1 }, { x: 12, opacity: 0.55 }),
  poses({ x: 0, opacity: 0.55 }, { x: 12, opacity: 0.3 }),
  poses({ x: 0, opacity: 0.3 }, { x: 8, opacity: 0 }),
];
const FRAME_X = [2, 2, 14, 26] as const;

// Hollow: the same three frames as outlines, and one clip that drops into the front frame.
const FIRST_CLIP = poses({ y: -4, opacity: 0 }, { y: 0, opacity: 1 });

function HollowLibraryMotif() {
  return (
    <svg aria-hidden {...SVG} data-motif="library" data-hollow className="overflow-hidden">
      {FRAME_X.slice(1).map((x, i) => (
        <rect
          key={x}
          x={x + 0.625}
          y={FRAME.y + 0.625}
          width={FRAME.width - 1.25}
          height={FRAME.height - 1.25}
          rx={FRAME.rx}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
          opacity={[1, 0.55, 0.3][i]}
        />
      ))}
      <motion.rect data-part {...FRAME} x={FRAME_X[0]} variants={FIRST_CLIP} custom={{ i: 0, n: 1 }} />
    </svg>
  );
}

function LibraryMotif() {
  return (
    <svg aria-hidden {...SVG} data-motif="library" className="overflow-hidden">
      {FRAMES.map((variants, i) => (
        <motion.rect
          key={i}
          data-part
          {...FRAME}
          x={FRAME_X[i]}
          variants={variants}
          custom={{ i, n: FRAMES.length }}
        />
      ))}
    </svg>
  );
}

// Reference: nine bars in 4/4, a downbeat on the first of each four.
const BARS = [18, 8, 12, 9, 18, 10, 14, 8, 18] as const;
const BAR = poses({ scaleY: 0.7 }, { scaleY: 1 });

function ReferenceMotif() {
  return (
    <svg aria-hidden {...SVG} data-motif="reference">
      {BARS.map((height, i) => (
        <motion.rect
          key={i}
          data-part
          x={1 + i * 4.5}
          y={10 - height / 2}
          width={2}
          height={height}
          rx={1}
          variants={BAR}
          custom={{ i, n: BARS.length }}
        />
      ))}
    </svg>
  );
}

// Template: slots of differing widths, as a breakdown cuts a reel; each holds a clip once played.
const SLOTS = [
  { x: 1, width: 7 },
  { x: 9.5, width: 11 },
  { x: 22, width: 6 },
  { x: 29.5, width: 9 },
] as const;
const SLOT = { y: 4, height: 12, rx: 1.5 } as const;
const CLIP = poses({ y: -4, opacity: 0 }, { y: 0, opacity: 1 });

function TemplateMotif() {
  return (
    <svg aria-hidden {...SVG} data-motif="template">
      {SLOTS.map((slot, i) => (
        <rect
          key={`slot-${i}`}
          {...slot}
          x={slot.x + 0.625}
          y={SLOT.y + 0.625}
          width={slot.width - 1.25}
          height={SLOT.height - 1.25}
          rx={SLOT.rx}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
        />
      ))}
      {SLOTS.map((slot, i) => (
        <motion.rect
          key={`clip-${i}`}
          data-part
          {...slot}
          {...SLOT}
          variants={CLIP}
          custom={{ i, n: SLOTS.length }}
        />
      ))}
    </svg>
  );
}

// Describe: three lines of words; the first is written, the rest wait as faint guides.
const WORDS = [
  [
    { x: 1, y: 3.5, width: 8 },
    { x: 11, y: 3.5, width: 11 },
    { x: 24, y: 3.5, width: 7 },
  ],
  [
    { x: 1, y: 9, width: 6 },
    { x: 9, y: 9, width: 13 },
    { x: 24, y: 9, width: 10 },
  ],
  [
    { x: 1, y: 14.5, width: 11 },
    { x: 14, y: 14.5, width: 6 },
  ],
] as const;
const WRITTEN = WORDS[0];
const TO_WRITE = [...WORDS[1], ...WORDS[2]];
const WORD = { height: 2.5, rx: 1.25 } as const;
const INK = poses({ opacity: 0.32 }, { opacity: 1 });

function DescribeMotif() {
  return (
    <svg aria-hidden {...SVG} data-motif="describe">
      {WRITTEN.map((word, i) => (
        <rect key={`written-${i}`} {...word} {...WORD} />
      ))}
      {TO_WRITE.map((word, i) => (
        <motion.rect
          key={`word-${i}`}
          data-part
          {...word}
          {...WORD}
          variants={INK}
          custom={{ i, n: TO_WRITE.length }}
        />
      ))}
    </svg>
  );
}

const MOTIFS: Readonly<Record<OpeningPath, ComponentType>> = {
  library: LibraryMotif,
  reference: ReferenceMotif,
  template: TemplateMotif,
  describe: DescribeMotif,
};

/**
 * A way's drawing. Its parts follow the nearest motion parent's `rest` and `play` (the tile's button), so the
 * motif itself holds no state. `hollow`: the library has nothing in it yet.
 */
export function OpeningMotif({
  path,
  hollow = false,
  className,
}: {
  path: OpeningPath;
  hollow?: boolean;
  className?: string;
}) {
  const Motif = hollow && path === 'library' ? HollowLibraryMotif : MOTIFS[path];
  return (
    <span aria-hidden data-slot="opening-motif" className={className}>
      <Motif />
    </span>
  );
}
