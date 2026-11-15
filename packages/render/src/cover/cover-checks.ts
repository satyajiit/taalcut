// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CVR2: what a drawn cover composition says about itself, measured in the page that drew it, each with what to do
 * about it for the model that made it. They are floors a tool can hold, not a judgement of the design:
 *
 * - `words`: every word is whole: on the canvas, and not cut by a box that clips it (lettering cut by an edge is a
 *   broken cover). Read from the glyphs' own boxes, since a clipped root hides the overflow from every other probe.
 * - `typeFloor`: the smallest words are as large as QA's floor for graphics, by cap height on the cover's canvas.
 * - `safeArea`: the headline (the largest words) sits inside the aspect's crop-safe area, the one the cover panel
 *   draws as "Safe zones"; smaller marks may sit outside it on purpose.
 * - `pictures`: under `medium: 'footage'`, the pictures the cover states are its picture: they loaded, they show,
 *   and they cover a real share of the canvas.
 * - `marks`: under `medium: 'footage'`, drawn shapes are marks over the picture (a rule, an arrow, a ring), not
 *   scenery: at most COVER_MARKS_MAX of them.
 */
import type { CompositionGateCheck, CoverMedium, ThumbnailAspect } from '@taalcut/core';
import { fontMetrics } from '../captions/fonts';
import { GRAPHICS_THRESHOLDS } from '../qa/checks/graphics';
import type { CaptionFontId } from '../types';
import type { ProbedContent } from '../workspace/frames/content-probe';

/** The share of the canvas a footage cover's pictures cover at least. */
export const COVER_PICTURE_SHARE_MIN = 0.3;
/** The SVG shapes a footage cover draws at most. */
export const COVER_MARKS_MAX = 8;
/** Runs at least this share of the largest words' size are the headline. */
const HEADLINE_SHARE = 0.6;
const TOLERANCE = 2;

/** The crop-safe area of a cover, as shares of the canvas (the cover panel's guide and the preset layout's). */
export function coverSafeRect(aspect: ThumbnailAspect) {
  const [top, bottom] = aspect === '9:16' ? [0.25, 0.25] : aspect === '4:5' ? [0.14, 0.14] : [0.08, 0.12];
  return { top, bottom, left: 0.07, right: aspect === '9:16' ? 0.18 : 0.15 };
}

/** What the page says of the cover's pictures and drawn shapes (`COVER_FACTS_PROBE`). */
export interface CoverFacts {
  readonly pictures: readonly {
    readonly name: string;
    readonly loaded: boolean;
    readonly shown: boolean;
    /** The share of the canvas its box covers, cut to the canvas. */
    readonly share: number;
  }[];
  readonly shapes: number;
  /** Words cut by the canvas or by a box that clips them: which edge, and by how many px. */
  readonly cut: readonly { readonly text: string; readonly edge: string; readonly by: number }[];
}

/** In-page: the cover clip's pictures (loaded, shown, how much canvas each covers) and its SVG shapes. */
export const coverFactsProbe = (width: number, height: number) => `(() => {
  const clip = document.querySelector('[data-tc-composition]');
  if (!clip) return { pictures: [], shapes: 0, cut: [] };
  const pictures = Array.from(clip.querySelectorAll('img[data-picture]')).map((img) => {
    const r = img.getBoundingClientRect();
    const w = Math.max(0, Math.min(${width}, r.right) - Math.max(0, r.left));
    const h = Math.max(0, Math.min(${height}, r.bottom) - Math.max(0, r.top));
    let shown = true;
    for (let at = img; at && at !== clip.parentElement; at = at.parentElement) {
      const s = getComputedStyle(at);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) <= 0.05) shown = false;
    }
    return {
      name: img.getAttribute('data-picture') || '',
      loaded: img.complete && img.naturalWidth > 0,
      shown,
      share: (w * h) / ${width * height},
    };
  });
  const shapes = clip.querySelectorAll('path, circle, ellipse, rect, line, polyline, polygon').length -
    clip.querySelectorAll('defs path, defs circle, defs ellipse, defs rect, defs line, defs polyline, defs polygon, ' +
      'clipPath *, mask *').length;
  const cut = [];
  const walker = document.createTreeWalker(clip, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent.trim();
    const part = node.parentElement;
    if (!text || !part) continue;
    let left = 0, right = ${width}, hidden = false;
    for (let at = part; at && at !== clip.parentElement; at = at.parentElement) {
      const s = getComputedStyle(at);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) <= 0.05) hidden = true;
      if (s.overflowX === 'visible') continue;
      const c = at.getBoundingClientRect();
      left = Math.max(left, c.left); right = Math.min(right, c.right);
    }
    if (hidden) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      if (r.width <= 0 || r.height <= 0) continue;
      // A line's box is taller than its letters: the middle of it is where the letters are.
      const body = r.height * 0.22;
      const over = [['left', left - r.left], ['right', r.right - right], ['top', -(r.top + body)], ['bottom', r.bottom - body - ${height}]]
        .sort((a, b) => b[1] - a[1])[0];
      if (over[1] > 2) cut.push({ text: text.slice(0, 40), edge: over[0], by: Math.round(over[1]) });
    }
  }
  return { pictures, shapes: Math.max(0, shapes), cut: cut.slice(0, 8) };
})()`;

export interface CoverChecksInput {
  readonly aspect: ThumbnailAspect;
  readonly width: number;
  readonly height: number;
  readonly medium: CoverMedium | undefined;
  readonly content: ProbedContent | null;
  readonly facts: CoverFacts;
  readonly fonts: readonly CaptionFontId[];
}

const px = (value: number) => `${Math.round(value)} px`;
const quote = (text: string) => `"${text.slice(0, 24)}"`;

function wordsCheck({ facts, width, height }: CoverChecksInput): CompositionGateCheck {
  const [worst] = [...facts.cut].sort((a, b) => b.by - a.by);
  if (!worst) return { id: 'words', status: 'pass' };
  return {
    id: 'words',
    status: 'fail',
    detail: `${quote(worst.text)} runs ${px(worst.by)} past the ${worst.edge} edge, so it is cut. Keep every word whole on the ${width}×${height} canvas: a smaller font-size, a max-width with wrapping, or fewer words.`,
  };
}

function typeFloorCheck({ content, width, height, fonts }: CoverChecksInput): CompositionGateCheck {
  const runs = content?.texts ?? [];
  if (runs.length === 0) return { id: 'typeFloor', status: 'skipped', detail: 'the cover draws no words' };
  const capShare = Math.min(
    ...(fonts.length ? fonts : (['notoSans'] as CaptionFontId[])).map((font) => fontMetrics(font).capHeight),
  );
  const floor = (GRAPHICS_THRESHOLDS.minCapHeightPx * Math.min(width, height)) / 1080;
  const smallest = runs.reduce((a, b) => (b.sizePx < a.sizePx ? b : a));
  const cap = smallest.sizePx * capShare;
  return cap + 0.01 >= floor
    ? { id: 'typeFloor', status: 'pass' }
    : {
        id: 'typeFloor',
        status: 'fail',
        detail: `${quote(smallest.text)} has a cap height of ${cap.toFixed(1)} px, under ${floor.toFixed(0)}: it will not read at feed size. Set it at font-size ${Math.ceil(floor / capShare)} px or more, or leave it out.`,
      };
}

function safeAreaCheck({ content, aspect, width, height }: CoverChecksInput): CompositionGateCheck {
  const runs = content?.texts ?? [];
  if (runs.length === 0) return { id: 'safeArea', status: 'skipped', detail: 'the cover draws no words' };
  const largest = Math.max(...runs.map((run) => run.sizePx));
  const headline = runs.filter((run) => run.sizePx >= largest * HEADLINE_SHARE);
  const safe = coverSafeRect(aspect);
  const box = {
    left: safe.left * width,
    top: safe.top * height,
    right: (1 - safe.right) * width,
    bottom: (1 - safe.bottom) * height,
  };
  for (const run of headline) {
    const left = run.left ?? box.left;
    const right = run.right ?? box.right;
    const bottom = run.bottom ?? run.top;
    const out =
      run.top < box.top - TOLERANCE
        ? `${px(box.top - run.top)} above it`
        : bottom > box.bottom + TOLERANCE
          ? `${px(bottom - box.bottom)} below it`
          : left < box.left - TOLERANCE
            ? `${px(box.left - left)} left of it`
            : right > box.right + TOLERANCE
              ? `${px(right - box.right)} right of it`
              : '';
    if (out)
      return {
        id: 'safeArea',
        status: 'fail',
        detail: `the headline ${quote(run.text)} sits ${out}: on a ${aspect} cover the area that survives every crop and the platform's own buttons is x ${px(box.left)}–${px(box.right)}, y ${px(box.top)}–${px(box.bottom)}. Move the headline inside it; smaller marks may stay outside.`,
      };
  }
  return { id: 'safeArea', status: 'pass' };
}

function picturesCheck({ facts, medium }: CoverChecksInput): CompositionGateCheck {
  const broken = facts.pictures.find((picture) => !picture.loaded);
  if (broken)
    return {
      id: 'pictures',
      status: 'fail',
      detail: `the picture "${broken.name}" did not load, so its image draws nothing`,
    };
  if (medium !== 'footage') return { id: 'pictures', status: 'pass' };
  const share = facts.pictures.filter((picture) => picture.shown).reduce((sum, p) => sum + p.share, 0);
  if (share + 1e-6 >= COVER_PICTURE_SHARE_MIN) return { id: 'pictures', status: 'pass' };
  return {
    id: 'pictures',
    status: 'fail',
    detail:
      facts.pictures.length === 0
        ? 'the cover states medium "footage" and draws no picture: a footage cover is built over a frame of the video. Add <img data-picture="…"> and state its frame in pictures.'
        : `the video's pictures cover ${Math.round(share * 100)}% of the cover, under ${Math.round(COVER_PICTURE_SHARE_MIN * 100)}%: on a footage cover the frame is the picture, not a stamp. Give it the room (full bleed, or a large panel).`,
  };
}

function marksCheck({ facts, medium }: CoverChecksInput): CompositionGateCheck {
  if (medium !== 'footage' || facts.shapes <= COVER_MARKS_MAX) return { id: 'marks', status: 'pass' };
  return {
    id: 'marks',
    status: 'fail',
    detail: `the cover draws ${facts.shapes} shapes. Over footage, shapes are marks (a rule, an arrow, a ring), at most ${COVER_MARKS_MAX}: the scene, the people and the objects are the picture's, never drawn.`,
  };
}

/** The checks a place of the cover refuses on: the cover is broken, or is not what its stated medium says. */
export const COVER_REFUSING_CHECKS: ReadonlySet<string> = new Set(['words', 'pictures', 'marks']);

export function coverChecks(input: CoverChecksInput): CompositionGateCheck[] {
  return [wordsCheck, typeFloorCheck, safeAreaCheck, picturesCheck, marksCheck].map((check) => {
    const result = check(input);
    return result.detail ? { ...result, detail: result.detail.slice(0, 500) } : result;
  });
}
