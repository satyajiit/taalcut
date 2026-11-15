// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: how a reel sets the letters of one overlay, from its settled pixels (core's `overlayTypeSchema`): the
 * letters' colour, whether they carry an outline and how wide, their stem for their height (their weight), how
 * wide they are set, how far apart, and whether a shadow sits under them. The made video's text takes its look
 * from this instead of the default face.
 *
 * The order: which cells are ink and which of its tones the letters (type-ink.ts); whether a second tone round
 * them is an outline, or a still patch, a soft edge or a still shadow; the strokes' soft edges (type-edges.ts);
 * then the measures (type-measure.ts) and how sure they are.
 *
 * What pixels can't say is left unsaid: the face's class (a serif, a script, a typewriter face) stays `font.class`,
 * and a reading that is not letters at all (a still patch of the picture, strokes too thick for their height), or
 * too unsure, is null, which leaves the design as it was before TXT1. Words with no tall letter (all x-height)
 * measure their x-height as the height, so they read about a step heavier than they are. The measures suppose
 * letters that stand apart on a line (Latin, Cyrillic, Greek); a script that joins its letters still gives its
 * colour, outline, stem and shadow, with less confidence. Pure.
 */
import type { OverlayType, OverlayTypeWidth } from '@taalcut/core';
import { distance, medianColour, pixel, type PixelRect, type RegionImage, type Rgb } from './pixels';
import type { Settled } from './shape';
import { distanceFrom, edgesOf, fades, grownLabels, type Adjust } from './type-edges';
import {
  LETTERS,
  OUTLINE,
  readInkMask,
  readTones,
  restOf,
  withoutOutline,
  type Grid,
  type InkRead,
} from './type-ink';
import {
  hasShadow,
  letterBoxes,
  lettersOnly,
  linesOf,
  outlineWidth,
  setOf,
  strokesOf,
  tallOf,
} from './type-measure';

/**
 * A weight from the stem's share of the letters' height: `[below, weight]`, first match; 900 past the last. Set
 * from the usual stems of a sans for its cap height (thin 0.045, extra light 0.065, light 0.085, regular 0.12,
 * medium 0.145, semibold 0.17, bold 0.2, extra bold 0.235, black 0.27), each threshold halfway between two.
 */
export const STEM_WEIGHTS: readonly (readonly [below: number, weight: number])[] = [
  [0.055, 100],
  [0.075, 200],
  [0.1, 300],
  [0.135, 400],
  [0.16, 500],
  [0.185, 600],
  [0.22, 700],
  [0.255, 800],
];

export function weightOfStem(share: number): number {
  for (const [below, weight] of STEM_WEIGHTS) if (share < below) return weight;
  return 900;
}

export const TYPE_LOOK = {
  /** A stem is between these shares of the letters' height; outside them the reading is not letters. */
  stemShare: { min: 0.02, max: 0.45 },
  /** Letters shorter than this, or with stems thinner than this (pixels), can't be measured at all. */
  minHeight: 5,
  minStem: 1.25,
  /** An outline is at most this share of the letters' height; a wider "outline" is a still patch behind them. */
  outlineShare: 0.3,
  /** A tone this narrow (pixels) on the line from the letters' colour to what lies behind is their soft edge. */
  softEdge: { width: 2.5, off: 40 },
  /**
   * A hard shadow: a second still tone, at least `least` of the letters' cells, with `share` of its cells within
   * `reach` of the letters' height from them and within `alike` (RGB) of one colour, `darker` (luma) than them.
   */
  hardShadow: { least: 0.05, reach: 0.25, share: 0.8, alike: 48, darker: 60 },
  /** A reading less sure than this is no reading. */
  least: 0.35,
  /** An outline is as still as its letters: its cells' spread over the frames is at most this much more (of 255). */
  restless: 10,
  /**
   * A letter's width over the letters' height: condensed under the first, wide over the second. Set from a
   * sans's capitals (about 0.8 in a normal face, 0.5 in a condensed one, 1.1 and more in an extended one).
   */
  widths: { condensed: 0.62, wide: 1.05 },
  /** The letters stand apart when the boxes that read as one letter each are at least this share of the letters. */
  joined: 0.8,
} as const;

export interface TypeInput {
  /** The settled frames' region images, and their median and spread (`settle`). */
  readonly frames: readonly RegionImage[];
  readonly settled: Settled;
  /** The words' box in region pixels. */
  readonly words: PixelRect;
  /** The shape the words sit on: its fill and its rect; null for words on the picture. */
  readonly fill: Rgb | null;
  readonly within?: PixelRect | null;
  /** How many letters and digits the words have, when known: boxes that don't add up to them lower the confidence. */
  readonly letters?: number;
}

/** Lengths in pixels of the region image. */
export interface TypeRead {
  /** The letters' own colour. */
  readonly fill: Rgb;
  readonly outline: { readonly colour: Rgb; readonly width: number } | null;
  /** The upright strokes' thickness, and the level strokes' when they could be told. */
  readonly stem: number;
  readonly bar: number | null;
  /** The letters' height: the top of the tallest letters to the baseline, to a fraction of a pixel. */
  readonly height: number;
  readonly shadow: boolean;
  /**
   * Null when the letters couldn't be told apart: with fewer boxes than `joined` of the letters the words have,
   * letters touch (a tight heavy face, an outline that bridges them), and a box is two letters wide.
   */
  readonly width: OverlayTypeWidth | null;
  /** What `width` was read from: a letter's width over the letters' height; null when no letter could be told. */
  readonly widthRatio: number | null;
  /** The gap between neighbouring letters; null with fewer than two, or when letters touch. */
  readonly spacing: number | null;
  readonly confidence: number;
}

interface Geometry {
  /** The labels measured: the lines' letters alone (and the outline). */
  readonly labels: Uint8Array;
  readonly stem: number;
  readonly bar: number | null;
  readonly height: number;
  readonly runs: number;
  readonly ratio: number | null;
  readonly gap: number | null;
  readonly letters: number;
}

/** The letters' measures from their cells; null when the cells are not letters (no lines, no strokes, blobs). */
function measure(all: Uint8Array, grid: Grid, adjust?: Adjust): Geometry | null {
  const { boxes, ids } = letterBoxes(all, grid);
  const lines = linesOf(all, grid, boxes);
  if (!lines || lines.height < TYPE_LOOK.minHeight) return null;
  const labels = lettersOnly(all, ids, lines.lines);
  const strokes = strokesOf(labels, grid, lines.lines, lines.height, adjust);
  // The upright strokes say the weight (a serif's level strokes are hairlines); the level ones stand in for none.
  const stroke = strokes.stem ?? strokes.bar;
  if (!stroke) return null;
  const height = adjust ? tallOf(labels, grid, lines.lines, adjust) : lines.height;
  const share = stroke.size / height;
  if (share < TYPE_LOOK.stemShare.min || share > TYPE_LOOK.stemShare.max) return null;
  return {
    labels,
    stem: stroke.size,
    bar: strokes.bar?.size ?? null,
    height,
    runs: stroke.runs,
    ...setOf(lines.lines),
  };
}

/** Whether `tone` is a mix of `a` and `b`: near the line between them, and between them. */
function isBlend(tone: Rgb, a: Rgb, b: Rgb): boolean {
  const span = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
  const length = span[0] * span[0] + span[1] * span[1] + span[2] * span[2];
  if (length < 1) return false;
  const along =
    ((tone[0] - a[0]) * span[0] + (tone[1] - a[1]) * span[1] + (tone[2] - a[2]) * span[2]) / length;
  if (along < 0.1 || along > 0.9) return false;
  const foot: Rgb = [a[0] + span[0] * along, a[1] + span[1] * along, a[2] + span[2] * along];
  return distance(tone, foot) <= TYPE_LOOK.softEdge.off;
}

const luma = (colour: Rgb) => 0.299 * colour[0] + 0.587 * colour[1] + 0.114 * colour[2];

/**
 * A hard shadow: a second still tone that is not the letters' outline (it doesn't wrap them), of one colour,
 * darker than the letters and lying against them, as a solid copy of the letters shifted a little does. Specks of
 * the picture that happened to be still are of every colour, and are not it; nor is the letters' own soft edge.
 */
function hardShadow(
  settled: Settled,
  read: InkRead,
  labels: Uint8Array,
  letters: Rgb,
  height: number,
): boolean {
  const { grid, ink, behind } = read;
  const given = TYPE_LOOK.hardShadow;
  const reach = distanceFrom(labels, grid, (label) => label === LETTERS);
  const close = Math.max(2, height * given.reach);
  const colours: Rgb[] = [];
  let all = 0;
  let lettered = 0;
  for (let index = 0; index < ink.length; index++) {
    if (labels[index] === LETTERS) lettered++;
    if (ink[index] !== 1 || labels[index] !== 0) continue;
    all++;
    if (reach[index]! > close) continue;
    const x = grid.rect.left + (index % grid.width);
    colours.push(pixel(settled.median, x, grid.rect.top + Math.floor(index / grid.width)));
  }
  if (all < Math.max(12, lettered * given.least) || colours.length < all * given.share) return false;
  const tone = medianColour(colours);
  const alike = colours.filter((colour) => distance(colour, tone) <= given.alike).length;
  // A mix of the letters and what lies behind them is their soft edge, not a shadow.
  if (alike < colours.length * given.share || isBlend(tone, letters, behind)) return false;
  return luma(tone) <= luma(letters) - given.darker;
}

export function readType(input: TypeInput): TypeRead | null {
  const { settled } = input;
  const read = readInkMask(settled, input.words, input.fill, input.within ?? null);
  if (!read) return null;
  const { grid } = read;
  let tones = readTones(settled, read);
  let rough = measure(tones.labels, grid);
  if (tones.mixed) {
    // Two tones that both reach the picture. The commoner is read, unless it is not letters at all, or the
    // rarer one's boxes are nearer the count of the words' letters.
    const other = readTones(settled, read, true);
    const otherRough = measure(other.labels, grid);
    const wanted = input.letters;
    const off = (geometry: Geometry) => (wanted === undefined ? 0 : Math.abs(wanted - geometry.letters));
    if (otherRough && (!rough || off(otherRough) < off(rough))) {
      tones = other;
      rough = otherRough;
    }
  }
  if (!rough) return null;
  if (tones.outline) {
    const width = outlineWidth(tones.labels, grid);
    // Not an outline: a still patch behind the letters, their own soft edge against what lies behind, a shadow
    // that is still because the picture is, or the picture itself, held nearly still by a shadow.
    const patch = width === null || width > rough.height * TYPE_LOOK.outlineShare;
    const soft =
      !patch && width < TYPE_LOOK.softEdge.width && isBlend(tones.outline, tones.letters, read.behind);
    const restless =
      restOf(settled, grid, tones.labels, OUTLINE) >
      restOf(settled, grid, tones.labels, LETTERS) + TYPE_LOOK.restless;
    if (patch || soft || restless || fades(settled, grid, tones.labels, tones, read.background)) {
      tones = withoutOutline(settled, read, tones, { softEdge: soft, mixed: patch });
      rough = measure(tones.labels, grid);
      if (!rough) return null;
    }
  }
  // From here the lines' letters alone: their soft edges join them, and every run is told to a fraction of a cell.
  const labels = grownLabels(settled, grid, { ...tones, labels: rough.labels });
  const shadow =
    hasShadow(input.frames, labels, grid, rough.height) ||
    hardShadow(settled, read, labels, tones.letters, rough.height);
  const adjust = edgesOf(settled, grid, labels, tones, shadow);
  const geometry = measure(labels, grid, adjust);
  // Strokes about a pixel wide are as likely the picture's grain as letters.
  if (!geometry || geometry.stem < TYPE_LOOK.minStem) return null;
  const outlined = tones.outline ? outlineWidth(labels, grid, adjust) : null;

  const ratio = geometry.ratio;
  // Measured on real faces (test/overlay-look/type-look-real-faces.int.test.ts): Bebas Neue's capitals, set tight,
  // came as boxes two letters wide and read 1.00, a normal face. Fewer boxes than letters: no width is claimed.
  const apart =
    ratio !== null && (input.letters === undefined || geometry.letters >= input.letters * TYPE_LOOK.joined);
  const width: OverlayTypeWidth | null = !apart
    ? null
    : ratio < TYPE_LOOK.widths.condensed
      ? 'condensed'
      : ratio > TYPE_LOOK.widths.wide
        ? 'wide'
        : 'normal';
  let confidence = 0.85;
  if (input.frames.length < 3) confidence -= 0.25;
  else if (input.frames.length < 5) confidence -= 0.05;
  if (geometry.height < 14) confidence -= 0.2;
  else if (geometry.height < 20) confidence -= 0.08;
  // A still picture: the ink was told by colour. One of many colours: by which colours the box has more of.
  if (read.stillBackground) confidence -= read.background ? 0.2 : 0.3;
  if (tones.mixed) confidence -= 0.15;
  if (geometry.runs < 12) confidence -= 0.1;
  // Joined letters (a script) or broken ones: the boxes are not the letters, so how they are set is a guess.
  const counted = input.letters ?? 0;
  if (
    ratio === null ||
    (counted >= 2 && (geometry.letters < counted * 0.5 || geometry.letters > counted * 2))
  )
    confidence -= 0.1;
  confidence = Math.round(Math.min(0.95, confidence) * 100) / 100;
  if (confidence < TYPE_LOOK.least) return null;
  return {
    fill: tones.letters,
    outline: tones.outline && outlined !== null ? { colour: tones.outline, width: outlined } : null,
    stem: geometry.stem,
    bar: geometry.bar,
    height: geometry.height,
    shadow,
    width,
    widthRatio: ratio,
    spacing: apart ? geometry.gap : null,
    confidence,
  };
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** The reading as the design's `type`: shares of the letters' height. On a shape no outline is claimed. */
export function typeOf(read: TypeRead, onShape: boolean): OverlayType {
  return {
    stem: round3(Math.min(1, read.stem / read.height)),
    outline: read.outline && !onShape ? round3(Math.min(0.5, read.outline.width / read.height)) : null,
    shadow: read.shadow,
    width: read.width,
    spacing: read.spacing === null ? null : round3(Math.min(2, read.spacing / read.height)),
    confidence: read.confidence,
  };
}
