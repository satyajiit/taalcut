// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The markup a workspace composition may hold (HFW1 gate): the base subset (html/markup.ts) widened to
 * what HyperFrames compositions write: ids, headings and text blocks, lists, images from the workspace's own
 * assets, and SVG with gradients, clips and text. Safety rules, not a design: no script, frame, object, form or
 * link element, no `style` attribute (the preview allows no inline style), no event handler, no `href`, and every
 * attribute value checked against a pattern. Words come from variables through HyperFrames' `data-var-text`.
 */
import { ALLOWED_TAGS, type MarkupRules } from '../html/markup';

const HTML_TAGS = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'section',
  'header',
  'footer',
  'article',
  'aside',
  'figure',
  'figcaption',
  'blockquote',
  'ul',
  'ol',
  'li',
  'small',
  'sub',
  'sup',
  'mark',
  'u',
  's',
  'img',
];
const SVG_TAGS = [
  'defs',
  'text',
  'tspan',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
].map((tag) => tag.toLowerCase());
const SVG_LEAVES = ['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'stop'];

export const WORKSPACE_TAGS: ReadonlySet<string> = new Set([...ALLOWED_TAGS, ...HTML_TAGS, ...SVG_TAGS]);

/** An authored id or class name: what HyperFrames compositions use, kept short. */
export const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/;
const CLASSES = /^[A-Za-z_][A-Za-z0-9_-]{0,47}(?:\s+[A-Za-z_][A-Za-z0-9_-]{0,47}){0,9}$/;
const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?$/;
const LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(?:px|%|em)?$/;
const NUMBERS = /^[-\d.eE,\s]{1,4000}$/;
const PATH = /^[MmLlHhVvCcSsQqTtAaZz\d\s,.eE+-]{1,8000}$/;
const COLOUR = /^(?:#[0-9a-fA-F]{3,4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgba?\([\d.,\s%]{1,40}\))$/;
/** A paint: a colour, none, currentColor, or a gradient or pattern of this composition by id. */
const PAINT = new RegExp(
  `^(?:none|currentColor|url\\(#[A-Za-z][A-Za-z0-9_-]{0,47}\\)|${COLOUR.source.slice(1, -1)})$`,
);
const LOCAL_REF = /^url\(#[A-Za-z][A-Za-z0-9_-]{0,47}\)$/;
const TRANSFORM = /^(?:\s*(?:translate|scale|rotate|skewX|skewY|matrix)\([-\d.,\s]{1,80}\))+\s*$/;
const VARIABLE = /^[a-z][a-zA-Z0-9]{0,23}$/;
/** An image is a workspace asset by its sha256 (the store's own path), never a URL. */
export const ASSET_PATH = /^assets\/[0-9a-f]{64}$/;

const keywords = (...words: string[]) => new RegExp(`^(?:${words.join('|')})$`);

/** SVG attributes by name, with their pattern. */
const SVG_ATTRIBUTES: Readonly<Record<string, RegExp>> = {
  xmlns: /^http:\/\/www\.w3\.org\/2000\/svg$/,
  viewBox: /^-?[\d.]+[\s,]+-?[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+$/,
  preserveAspectRatio: /^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?:\s+(?:meet|slice))?)$/,
  d: PATH,
  cx: LENGTH,
  cy: LENGTH,
  r: LENGTH,
  rx: LENGTH,
  ry: LENGTH,
  fx: LENGTH,
  fy: LENGTH,
  x: LENGTH,
  y: LENGTH,
  dx: LENGTH,
  dy: LENGTH,
  x1: LENGTH,
  y1: LENGTH,
  x2: LENGTH,
  y2: LENGTH,
  width: LENGTH,
  height: LENGTH,
  points: NUMBERS,
  pathLength: NUMBER,
  offset: LENGTH,
  fill: PAINT,
  stroke: PAINT,
  'stop-color': PAINT,
  'stop-opacity': NUMBER,
  'fill-opacity': NUMBER,
  'stroke-opacity': NUMBER,
  'stroke-width': LENGTH,
  'stroke-dasharray': NUMBERS,
  'stroke-dashoffset': LENGTH,
  'stroke-miterlimit': NUMBER,
  'stroke-linecap': keywords('butt', 'round', 'square'),
  'stroke-linejoin': keywords('miter', 'round', 'bevel'),
  'fill-rule': keywords('nonzero', 'evenodd'),
  'clip-rule': keywords('nonzero', 'evenodd'),
  'clip-path': LOCAL_REF,
  mask: LOCAL_REF,
  gradientUnits: keywords('userSpaceOnUse', 'objectBoundingBox'),
  clipPathUnits: keywords('userSpaceOnUse', 'objectBoundingBox'),
  maskUnits: keywords('userSpaceOnUse', 'objectBoundingBox'),
  gradientTransform: TRANSFORM,
  transform: TRANSFORM,
  opacity: NUMBER,
  'text-anchor': keywords('start', 'middle', 'end'),
  'dominant-baseline': keywords('auto', 'middle', 'central', 'hanging', 'alphabetic'),
};

/** Attributes any element may carry, with their pattern (data-composition-* only on the root: document.ts). */
const GLOBAL_ATTRIBUTES: Readonly<Record<string, RegExp>> = {
  id: NAME,
  class: CLASSES,
  lang: /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/,
  dir: keywords('ltr', 'rtl', 'auto'),
  'aria-hidden': keywords('true', 'false'),
  'aria-label': /^[^<>]{0,160}$/,
  role: keywords('presentation', 'img', 'none'),
  'data-var-text': VARIABLE,
  'data-start': NUMBER,
  'data-duration': NUMBER,
  'data-track-index': /^\d{1,2}$/,
  'data-layout-allow-overflow': /^(?:|true)$/,
  'data-composition-id': NAME,
  'data-width': /^\d{2,5}$/,
  'data-height': /^\d{2,5}$/,
};

const IMAGE_ATTRIBUTES: Readonly<Record<string, RegExp>> = {
  src: ASSET_PATH,
  alt: /^[^<>]{0,160}$/,
  width: /^\d{1,5}$/,
  height: /^\d{1,5}$/,
};

const SVG_ELEMENT = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  ...SVG_TAGS,
]);

function attributeProblem(tag: string, name: string, value: string): string | null {
  if (/^on/i.test(name)) return `the event handler ${name}`;
  if (name === 'style') return 'a style attribute';
  if (name === 'href' || name.endsWith('href')) return `the attribute ${name}`;
  const pattern =
    GLOBAL_ATTRIBUTES[name] ??
    (tag === 'img' ? IMAGE_ATTRIBUTES[name] : undefined) ??
    (SVG_ELEMENT.has(tag) ? SVG_ATTRIBUTES[name] : undefined);
  if (!pattern) return `the attribute ${name}`;
  return pattern.test(value) ? null : `${name}="${value.slice(0, 30)}"`;
}

export const WORKSPACE_MARKUP: MarkupRules = {
  tags: WORKSPACE_TAGS,
  leaves: new Set(SVG_LEAVES),
  voids: new Set(['img']),
  attributeProblem,
  maxText: 400,
  keepSpace: true,
};

export const WORKSPACE_MARKUP_LIMITS = { nodes: 400, depth: 24 } as const;

/** The fix hint for a markup problem the parser reports. */
export function markupFixHint(problem: string): string {
  if (problem.includes('style attribute'))
    return 'Move the inline style into the <style> block as a rule on the element’s id or class.';
  if (problem.includes('event handler'))
    return 'Remove it: compositions take no input; motion goes on the timeline.';
  if (problem.includes('href'))
    return 'Remove the link: a composition shows, it does not navigate or reuse by href.';
  if (problem.startsWith('the tag'))
    return `Use the allowed elements: ${[...WORKSPACE_TAGS].sort().join(', ')}. Media and scripts are Taalcut’s to add.`;
  if (problem.includes('src='))
    return 'Images are workspace assets: write src="assets/<sha256>" (the store’s path, no extension) for a file the workspace holds.';
  if (problem.includes('more than')) return 'Simplify the design: fewer elements.';
  return 'Write the element and its attributes as plain HTML or SVG with literal values (no expressions).';
}
