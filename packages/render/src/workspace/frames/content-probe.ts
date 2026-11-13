// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where a composition's drawn content is (HFW1 frames, and QA's DOM probe): the union of the boxes of its parts
 * that paint something — words (their text's own boxes), an element with a background, border or shadow that shows,
 * an image, an SVG shape with a fill or stroke — each cut by the boxes that clip it (overflow other than visible)
 * and skipped when it or a box above it is hidden or fully transparent. The composition's root covers the canvas,
 * so its own box says nothing; only what paints counts. Each word run also says its size (with the transforms'
 * scale above it), its colour and the colour painted behind its middle (null when only the picture is).
 */

/** In-page helpers: `compositionContent(clip)` → { box, texts } in canvas px, box null when nothing shows. */
export const CONTENT_HELPERS = `
  const tcHidden = (node, stop) => {
    for (let at = node; at && at !== stop.parentElement; at = at.parentElement) {
      const s = getComputedStyle(at);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) <= 0.01) return true;
    }
    return false;
  };
  const tcClip = (r, part, stop) => {
    let left = r.left, top = r.top, right = r.right, bottom = r.bottom;
    for (let at = part.parentElement; at && at !== stop.parentElement; at = at.parentElement) {
      const s = getComputedStyle(at);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const c = at.getBoundingClientRect();
      left = Math.max(left, c.left); top = Math.max(top, c.top); right = Math.min(right, c.right); bottom = Math.min(bottom, c.bottom);
    }
    return right > left && bottom > top ? { left, top, right, bottom } : null;
  };
  const tcClear = (colour) => !colour || colour === 'transparent' || /rgba\\([^)]*,\\s*0\\)$/.test(colour);
  const tcHex = (colour) => {
    const m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(colour || '');
    return m ? '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('') : null;
  };
  const tcScale = (node) => {
    let value = 1;
    for (let at = node; at; at = at.parentElement) {
      const t = getComputedStyle(at).transform;
      if (t && t !== 'none') { const m = new DOMMatrix(t); value *= Math.hypot(m.a, m.b); }
    }
    return value;
  };
  const tcPaints = (part) => {
    const s = getComputedStyle(part);
    if (part instanceof SVGElement) {
      const tag = part.tagName.toLowerCase();
      if (tag === 'svg' || tag === 'g' || tag === 'defs' || part.closest('defs, clipPath, mask, linearGradient, radialGradient')) return false;
      const fills = s.fill && s.fill !== 'none' && !tcClear(s.fill);
      // A stroke drawn to nothing yet (DrawSVG at 0%: a first dash of 0) paints nothing.
      const dash = s.strokeDasharray && s.strokeDasharray !== 'none' ? parseFloat(s.strokeDasharray) : null;
      const strokes = s.stroke && s.stroke !== 'none' && !tcClear(s.stroke) && parseFloat(s.strokeWidth) > 0 && !(dash !== null && dash <= 0.01);
      return Boolean(fills || strokes);
    }
    if (part.tagName === 'IMG' || (part.tagName === 'CANVAS' && part.hasAttribute('data-tc-three'))) return true;
    if (!tcClear(s.backgroundColor) || (s.backgroundImage && s.backgroundImage !== 'none')) return true;
    if (s.boxShadow && s.boxShadow !== 'none') return true;
    return ['Top', 'Right', 'Bottom', 'Left'].some((side) =>
      parseFloat(s['border' + side + 'Width']) > 0 && s['border' + side + 'Style'] !== 'none' && !tcClear(s['border' + side + 'Color']));
  };
  const tcBackdrop = (el, x, y, clip) => {
    const own = getComputedStyle(el).backgroundColor;
    if (!tcClear(own)) return tcHex(own);
    let below = false;
    for (const under of document.elementsFromPoint(x, y)) {
      if (under === el || el.contains(under)) { below = true; continue; }
      if (!below) continue;
      if (!clip.contains(under)) return null;
      const fill = getComputedStyle(under).backgroundColor;
      if (!tcClear(fill)) return tcHex(fill);
    }
    return null;
  };
  const compositionContent = (clip) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (r) => { x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); };
    const texts = [];
    if (tcHidden(clip, clip)) return { box: null, texts };
    for (const part of clip.querySelectorAll('*')) {
      if (tcHidden(part, clip)) continue;
      if (tcPaints(part)) { const r = tcClip(part.getBoundingClientRect(), part, clip); if (r) add(r); }
      const runs = Array.from(part.childNodes).filter((n) => n.nodeType === 3 && n.textContent.trim() !== '');
      for (const node of runs) {
        const range = document.createRange();
        range.selectNodeContents(node);
        // A glyph's line box can reach past its element's (a tight line-height): the words are drawn in the element.
        const own = part.getBoundingClientRect();
        for (const rect of range.getClientRects()) {
          const inner = {
            left: Math.max(rect.left, own.left), top: Math.max(rect.top, own.top),
            right: Math.min(rect.right, own.right), bottom: Math.min(rect.bottom, own.bottom),
          };
          if (inner.right <= inner.left || inner.bottom <= inner.top) continue;
          const r = tcClip(inner, part, clip);
          if (!r) continue;
          add(r);
          const s = getComputedStyle(part);
          texts.push({
            text: node.textContent.trim().slice(0, 40),
            top: r.top,
            left: r.left,
            right: r.right,
            bottom: r.bottom,
            sizePx: parseFloat(s.fontSize) * tcScale(part),
            colour: tcHex(s.color),
            family: s.fontFamily,
            backdrop: tcBackdrop(part, (r.left + r.right) / 2, (r.top + r.bottom) / 2, clip),
          });
        }
      }
    }
    return { box: Number.isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null, texts };
  };
`;

/** One composition clip's drawn content, as `CONTENT_PROBE` returns it. */
export interface ProbedContent {
  readonly id: string;
  readonly box: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  } | null;
  readonly texts: readonly {
    readonly text: string;
    readonly top: number;
    /** The run's other edges, px on the canvas (absent from a probe before HFW1-TPL's type). */
    readonly left?: number;
    readonly right?: number;
    readonly bottom?: number;
    readonly sizePx: number;
    readonly colour: string | null;
    readonly family: string;
    readonly backdrop: string | null;
  }[];
}

/**
 * How many lines its words sit on: their runs' tops, a run within half its size of the line above on that line
 * (a bold word or a smaller one beside it shares the line).
 */
export function lineCount(content: ProbedContent | null): number {
  const runs = [...(content?.texts ?? [])].sort((a, b) => a.top - b.top);
  let lines = 0;
  let last = -Infinity;
  let size = 0;
  for (const run of runs) {
    if (run.top - last > Math.min(size, run.sizePx) / 2) {
      lines += 1;
      last = run.top;
      size = run.sizePx;
    }
  }
  return lines;
}

/**
 * Its words' type as drawn, px on the canvas: the largest run's font size, and the gaps between all its runs and its
 * drawn content's edges (the padding as it reads). Null without words or their edges.
 */
export function typeOf(
  content: ProbedContent | null,
): { fontPx: number; padding: { top: number; right: number; bottom: number; left: number } } | null {
  const runs = content?.texts ?? [];
  const box = content?.box;
  if (!box || runs.length === 0 || runs.some((run) => run.left === undefined)) return null;
  const left = Math.min(...runs.map((run) => run.left!));
  const right = Math.max(...runs.map((run) => run.right!));
  const top = Math.min(...runs.map((run) => run.top));
  const bottom = Math.max(...runs.map((run) => run.bottom!));
  const px = (value: number) => Math.round(value * 10) / 10;
  return {
    fontPx: px(Math.max(...runs.map((run) => run.sizePx))),
    padding: {
      top: px(top - box.y),
      right: px(box.x + box.width - right),
      bottom: px(box.y + box.height - bottom),
      left: px(left - box.x),
    },
  };
}

/** Every composition clip on the page (`[data-tc-composition]`) and its drawn content. */
export const CONTENT_PROBE = `(() => {${CONTENT_HELPERS}
  return Array.from(document.querySelectorAll('[data-tc-composition]')).map((clip) => ({ id: clip.id.slice(2), ...compositionContent(clip) }));
})()`;
