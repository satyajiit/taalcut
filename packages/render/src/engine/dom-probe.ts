// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The script the capture page runs to read Chrome's own layout at the current frame (SPEC section 9, P3.4,
 * P3.2): each visible motion graphic's box and smallest type, each visible text or caption's box and lines (and
 * a caption's words), each visual's crop styles, and the fonts that loaded. Pieces in page JavaScript, joined into
 * one expression.
 */
import { CONTENT_HELPERS } from '../workspace/frames/content-probe';

/** Colour as #rrggbb, and whether an element and its ancestors show. */
const HELPERS = `
  const hex = (css) => {
    const m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(css);
    if (!m) return '#000000';
    return '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
  };
  const visible = (el) => {
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const s = getComputedStyle(node);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    }
    return true;
  };
`;

/**
 * A caption's words as drawn: each word box with its transform (one line tall, as laid out), widened by its
 * stroke at its scale; the scale is CSS `scale` times the transform matrix's, as for visuals. A caption's lines
 * are counted from where its words are laid out (offsetTop ignores transforms), so a popped word, scaled up off
 * its line's top, is never taken for a line of its own.
 */
const WORDS = `
  const wordsOf = (el, stroke) => Array.from(el.querySelectorAll('.tc-word')).map((w) => {
    const s = getComputedStyle(w);
    const css = s.scale === 'none' ? 1 : Number(s.scale.split(' ')[0]);
    const m = /^matrix(?:3d)?\\(([^,]+),\\s*([^,]+)/.exec(s.transform);
    const scale = css * (m ? Math.hypot(Number(m[1]), Number(m[2])) : 1);
    const r = w.getBoundingClientRect();
    const grow = stroke * scale;
    return { box: { x: r.left - grow, y: r.top, width: r.width + 2 * grow, height: r.height }, scale };
  });
  const wordLines = (el) => {
    let lines = 0, top = -Infinity;
    for (const w of el.querySelectorAll('.tc-word')) {
      if (w.offsetTop > top + w.offsetHeight / 2) { lines += 1; top = w.offsetTop; }
    }
    return lines;
  };`;

/**
 * [data-tc-text] (texts and caption cues): the laid-out text's rects, grown by the padding and the stroke;
 * for a caption, its words as well.
 */
const TEXT_BOXES = `
  for (const el of document.querySelectorAll('[data-tc-text]')) {
    if (!visible(el)) continue;
    const style = getComputedStyle(el);
    const target = el.querySelector('.tc-inner') || el;
    const range = document.createRange();
    range.selectNodeContents(target);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    if (rects.length === 0) continue;
    const inner = getComputedStyle(target);
    const pad = parseFloat(inner.paddingLeft) || 0;
    const stroke = (parseFloat(style.webkitTextStrokeWidth) || 0) / 2;
    const grow = pad + stroke;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const tops = new Set();
    for (const r of rects) {
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
      tops.add(Math.round(r.top / 4));
    }
    const text = (el.textContent || '').trim();
    const caption = el.classList.contains('tc-cue');
    out.push({
      kind: caption ? 'caption' : 'text',
      id: el.id.slice(2),
      box: { x: Math.floor(x0 - grow), y: Math.floor(y0 - grow), width: Math.ceil(x1 - x0 + 2 * grow), height: Math.ceil(y1 - y0 + 2 * grow) },
      lines: caption ? wordLines(el) : tops.size,
      overflow: el.scrollWidth > el.clientWidth + 1,
      text,
      families: style.fontFamily,
      color: hex(style.color),
      ...(caption ? { words: wordsOf(el, stroke) } : {}),
    });
  }`;

/**
 * [data-tc-visual]: what the reframe animates (P3-V2). `scale` is the effective one: CSS `scale` times the
 * transform matrix's, since GSAP folds the CSS property into the transform once it animates the element (SPEC G.4).
 */
const VISUALS = `
  const visuals = [];
  for (const el of document.querySelectorAll('[data-tc-visual]')) {
    const s = getComputedStyle(el);
    const css = s.scale === 'none' ? 1 : Number(s.scale.split(' ')[0]);
    const m = /^matrix(?:3d)?\\(([^,]+),\\s*([^,]+)/.exec(s.transform);
    const scale = css * (m ? Math.hypot(Number(m[1]), Number(m[2])) : 1);
    const region = el.closest('[data-tc-layout-region]');
    const rectOf = (node) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    visuals.push({ ...(region ? { box: rectOf(el), viewport: rectOf(region), clipPath: s.clipPath } : {}), id: el.getAttribute('data-tc-visual'), objectPosition: s.objectPosition, scale: String(scale), transformOrigin: s.transformOrigin, opacity: Number(s.opacity) });
  }`;

/** Returns `{ boxes, visuals, loaded }`. */
/**
 * HFW1: a composition graphic ([data-tc-composition]) by what it draws (workspace/frames/content-probe.ts), not by
 * its root, which covers the canvas: QA's face and safe-zone checks see the content.
 */
const COMPOSITION_BOXES = `${CONTENT_HELPERS}
  for (const clip of document.querySelectorAll('[data-tc-composition]')) {
    const drawn = compositionContent(clip);
    if (!drawn.box) continue;
    const sized = drawn.texts.filter((t) => Number.isFinite(t.sizePx));
    const smallest = sized.reduce((low, t) => (low && low.sizePx <= t.sizePx ? low : t), null);
    const words = drawn.texts.filter((t) => t.left !== undefined && t.right > t.left && t.bottom > t.top);
    const textBounds = words.length ? {
      x: Math.min(...words.map((t) => t.left)), y: Math.min(...words.map((t) => t.top)),
      width: Math.max(...words.map((t) => t.right)) - Math.min(...words.map((t) => t.left)),
      height: Math.max(...words.map((t) => t.bottom)) - Math.min(...words.map((t) => t.top)),
    } : null;
    out.push({
      kind: 'graphic',
      id: clip.id.slice(2),
      box: { x: Math.floor(drawn.box.x), y: Math.floor(drawn.box.y), width: Math.ceil(drawn.box.width), height: Math.ceil(drawn.box.height) },
      lines: new Set(drawn.texts.map((t) => Math.round(t.top / 4))).size,
      overflow: false,
      text: drawn.texts.map((t) => t.text).join(' '),
      families: drawn.texts.length ? drawn.texts[0].family : getComputedStyle(clip).fontFamily,
      color: drawn.texts.length ? drawn.texts[0].colour : null,
      ...(smallest ? { minFontPx: smallest.sizePx, minFontFamily: smallest.family } : {}),
      ...(clip.hasAttribute('data-tc-program') && textBounds ? { textBounds } : {}),
      ...(clip.hasAttribute('data-tc-program') ? { program: true } : {}),
    });
  }`;

export const DOM_PROBE = `(() => {${HELPERS}
  const out = [];${WORDS}${COMPOSITION_BOXES}${TEXT_BOXES}${VISUALS}
  const loaded = Array.from(document.fonts).filter((f) => f.status === 'loaded').map((f) => f.family.replace(/^["']|["']$/g, ''));
  return { boxes: out, visuals, loaded };
})()`;
