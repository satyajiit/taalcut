// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One overlay's design from its pixels (BRK1-GFX): the settled frames give its shape, colours, corners, tail and
 * type; the frames round its edges give its entrance, exit and typing. A chat bubble is a filled shape with a tail;
 * a pill one with round ends; a lower third a wide band low in the frame; any other filled shape a label; words
 * with no shape are plain; a bubble with a small mark beside its words has read ticks (marks.ts). Pixels can't
 * name a typeface, so the class is sans and the confidence says so. Pure.
 */
import type { Box, OverlayDesign } from '@taalcut/core';
import { entranceOf, exitOf, presence, shapeFirst, type EdgeFrames, type Mask } from './motion';
import { hex, settle, type PixelRect, type RegionImage, type Rgb } from './pixels';
import { hasReceipt, marksOf } from './marks';
import { readInk, readShape, weightOf, type ShapeRead } from './shape';

export interface DesignInput {
  /** The frame's size, in pixels. */
  readonly width: number;
  readonly height: number;
  /** The region read, in frame pixels, and the words' box inside it (region pixels). */
  readonly region: PixelRect;
  readonly words: PixelRect;
  /** The words' first frame and the frame after their last. */
  readonly start: number;
  readonly end: number;
  /** Region images of frames well inside the overlay's time. */
  readonly settled: readonly RegionImage[];
  /** Region images of frames round its edges, in order. */
  readonly edges: EdgeFrames;
}

/** A shape's corners are a pill's from this share of its height. */
const PILL = 0.42;
/** Frames a shape is there before its words to count as typing. */
const TYPING_FRAMES = 4;

function kindOf(shape: ShapeRead, input: DesignInput): OverlayDesign['kind'] {
  if (shape.tail !== 'none') return 'chatBubble';
  const height = shape.rect.bottom - shape.rect.top;
  if (shape.radius / height >= PILL) return 'pill';
  const wide = (shape.rect.right - shape.rect.left) / input.width >= 0.6;
  const low = (input.region.top + shape.rect.top) / input.height >= 0.6;
  return wide && low ? 'lowerThird' : 'label';
}

/** The shape's box, normalised to the frame. */
function boxOf(rect: PixelRect, input: DesignInput): Box {
  const x = (input.region.left + rect.left) / input.width;
  const y = (input.region.top + rect.top) / input.height;
  return {
    x,
    y,
    width: Math.min(1 - x, (rect.right - rect.left) / input.width),
    height: Math.min(1 - y, (rect.bottom - rect.top) / input.height),
  };
}

/** Whether the words came on after the shape: typed (ink grew) or after a typing indicator (no ink first). */
function typed(
  input: DesignInput,
  ink: Rgb,
  inkShare: number,
  first: number,
): 'typing' | 'typewriter' | null {
  if (input.start - first < TYPING_FRAMES) return null;
  const mask: Mask = { rect: input.words, hole: null, colour: ink };
  const before = input.edges.frames.filter((entry) => entry.frame >= first && entry.frame < input.start);
  if (before.length === 0) return null;
  const shares = before.map((entry) => presence(entry.image, mask).share / Math.max(inkShare, 1e-6));
  const mean = shares.reduce((sum, share) => sum + share, 0) / shares.length;
  return mean < 0.2 ? 'typing' : 'typewriter';
}

export function readDesign(input: DesignInput): OverlayDesign | null {
  return readDesignAndLead(input)?.design ?? null;
}

/**
 * The design and how many frames its shape showed before its words (DSG1-READ: a typing indicator's length); 0 when
 * the words came with the shape. `first`: the frame its shape (or its words) first shows on, round which HFW1 judges
 * the entrance (the caller reads the frames there it lacked, `edgeFramesFor`, and asks again).
 */
export function readDesignAndLead(
  input: DesignInput,
): { design: OverlayDesign; lead: number; first: number } | null {
  if (input.settled.length === 0) return null;
  const settled = settle(input.settled);
  const found = readShape(settled, input.words);
  // A fill that never ends is a still wall behind the words, not a shape.
  const shape = found?.bounded ? found : null;
  const ink = readInk(settled, input.words, shape?.fill ?? null);
  if (!ink) return null;
  // Read ticks are a chat bubble's: only a shape with a tail is looked at for them.
  const receipt =
    shape !== null &&
    shape.tail !== 'none' &&
    hasReceipt(marksOf(settled, shape.fill, shape.rect, input.words), input.words.bottom - input.words.top);
  const mask: Mask = shape
    ? { rect: shape.rect, hole: input.words, colour: shape.fill }
    : { rect: input.words, hole: null, colour: ink.colour };
  const full = presence(settled.median, mask);
  const first = shape ? shapeFirst(input.edges, mask, full, input.start) : input.start;
  const typing = shape ? typed(input, ink.colour, ink.share, first) : null;
  const height = shape ? shape.rect.bottom - shape.rect.top : 1;
  const confidence = shape
    ? Math.min(0.95, 0.5 + 0.35 * shape.evenness + (shape.tail === 'none' ? 0 : 0.05))
    : found
      ? 0.4
      : 0.55;
  const design: OverlayDesign = {
    kind: shape ? kindOf(shape, input) : 'plain',
    colors: { fill: shape ? hex(shape.fill) : null, text: hex(ink.colour), stroke: null },
    cornerRadius: shape ? Math.round(Math.min(0.5, shape.radius / height) * 100) / 100 : 0,
    tail: shape?.tail ?? 'none',
    font: { class: 'sans', weight: weightOf(ink.share) },
    motion: {
      enter: typing === 'typewriter' ? 'typewriter' : entranceOf(input.edges, mask, full, first),
      exit: exitOf(input.edges, mask, full, input.end),
      typing: typing === 'typing',
    },
    ...(shape ? { shape: boxOf(shape.rect, input) } : {}),
    ...(receipt ? { receipt: true } : {}),
    confidence: Math.round(confidence * 100) / 100,
  };
  return { design, lead: Math.max(0, input.start - first), first };
}
