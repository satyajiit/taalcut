// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The styles a workspace composition may hold (HFW1 gate): the base checked properties (html/css.ts)
 * widened to what HyperFrames compositions write: type (from the bundled fonts only), grid and flex layout,
 * gradients, text effects, 3D. Safety rules, not a design: still no at-rule (so no `@import`, `@font-face`,
 * `@keyframes` or `@media`), no `url()` but a workspace asset's, no transition or CSS animation (motion is the one
 * timeline), nothing fixed to the viewport, and no unit that depends on it. Selectors may name ids; the fold scopes
 * every rule under the item's own element.
 */
import { CAPTION_FONT_FILES } from '../../captions/fonts';
import { COMPONENT_PROPERTIES, declarationProblemIn, type CssRules } from '../html/css';
import { VALUE_FUNCTIONS, VALUE_UNITS, type ValueContext } from '../html/values';
import { NAME, WORKSPACE_TAGS } from './markup-rules';

const KEYWORDS = (...words: string[]) => new RegExp(`^(?:${words.join('|')})$`);
const ANY = null;
const any = (...properties: string[]) => Object.fromEntries(properties.map((property) => [property, ANY]));

/** DSG1's table, its keyword sets widened, plus type, layout and effects. */
export const WORKSPACE_PROPERTIES: Readonly<Record<string, RegExp | null>> = {
  ...COMPONENT_PROPERTIES,
  display: KEYWORDS(
    'block',
    'inline',
    'inline-block',
    'flex',
    'inline-flex',
    'grid',
    'inline-grid',
    'none',
    'contents',
  ),
  'z-index': /^-?\d{1,3}$/,
  'flex-wrap': KEYWORDS('nowrap', 'wrap', 'wrap-reverse'),
  'align-items': KEYWORDS(
    'start',
    'end',
    'center',
    'stretch',
    'flex-start',
    'flex-end',
    'baseline',
    'normal',
  ),
  'align-self': KEYWORDS('auto', 'start', 'end', 'center', 'stretch', 'flex-start', 'flex-end', 'baseline'),
  'align-content': KEYWORDS('start', 'end', 'center', 'stretch', 'space-between', 'space-around', 'normal'),
  'justify-items': KEYWORDS('start', 'end', 'center', 'stretch', 'normal'),
  'justify-self': KEYWORDS('auto', 'start', 'end', 'center', 'stretch'),
  'mix-blend-mode': KEYWORDS('normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference'),
  'font-weight': /^(?:normal|bold|[1-9]00)$/,
  'font-style': KEYWORDS('normal', 'italic'),
  'text-transform': KEYWORDS('none', 'uppercase', 'lowercase', 'capitalize'),
  'text-wrap': KEYWORDS('wrap', 'nowrap', 'balance', 'pretty'),
  'white-space': KEYWORDS('normal', 'nowrap', 'pre-line', 'pre-wrap'),
  'overflow-wrap': KEYWORDS('normal', 'anywhere', 'break-word'),
  'word-break': KEYWORDS('normal', 'break-word', 'keep-all'),
  'vertical-align': KEYWORDS('baseline', 'middle', 'top', 'bottom', 'text-top', 'text-bottom'),
  'font-variant-numeric': KEYWORDS('normal', 'tabular-nums', 'lining-nums'),
  'text-decoration-line': KEYWORDS('none', 'underline', 'line-through', 'overline'),
  'object-fit': KEYWORDS('cover', 'contain', 'fill', 'none', 'scale-down'),
  'background-repeat': KEYWORDS('no-repeat', 'repeat', 'repeat-x', 'repeat-y'),
  'background-clip': KEYWORDS('border-box', 'padding-box', 'content-box', 'text'),
  '-webkit-background-clip': KEYWORDS('border-box', 'padding-box', 'content-box', 'text'),
  'paint-order': KEYWORDS('normal', 'stroke', 'fill', 'stroke fill', 'fill stroke'),
  'transform-style': KEYWORDS('flat', 'preserve-3d'),
  'backface-visibility': KEYWORDS('visible', 'hidden'),
  isolation: KEYWORDS('auto', 'isolate'),
  'overflow-x': KEYWORDS('visible', 'hidden', 'clip'),
  'overflow-y': KEYWORDS('visible', 'hidden', 'clip'),
  'font-family': ANY,
  ...any(
    'font-size',
    'line-height',
    'letter-spacing',
    'word-spacing',
    'text-indent',
    'text-decoration-color',
    'text-decoration-thickness',
    'text-underline-offset',
    'grid-template-columns',
    'grid-template-rows',
    'grid-column',
    'grid-row',
    'place-items',
    'place-content',
    'place-self',
    'column-gap',
    'row-gap',
    'order',
    'aspect-ratio',
    'object-position',
    'background-image',
    'background-size',
    'background-position',
    '-webkit-text-fill-color',
    '-webkit-text-stroke',
    '-webkit-text-stroke-width',
    '-webkit-text-stroke-color',
    'backdrop-filter',
    'perspective',
    'perspective-origin',
    'stop-color',
    'stop-opacity',
    'fill-opacity',
    'stroke-opacity',
    'outline-color',
    'outline-width',
    'outline-style',
    'border-top-color',
    'border-bottom-color',
    'border-left-color',
    'border-right-color',
    'border-top-width',
    'border-bottom-width',
    'border-left-width',
    'border-right-width',
  ),
};

export const WORKSPACE_UNITS: ReadonlySet<string> = new Set([...VALUE_UNITS, 'rem', 'ch', 'ex', 'lh']);
export const WORKSPACE_FUNCTIONS: ReadonlySet<string> = new Set([
  ...VALUE_FUNCTIONS,
  'repeat',
  'minmax',
  'fit-content',
  'hue-rotate',
  'invert',
  'sepia',
  'translate3d',
  'translatez',
  'rotatex',
  'rotatey',
  'rotatez',
  'perspective',
  'scale3d',
  'color-mix',
]);

/** The bundled families by name (lower case), each with its font id. */
export const CURATED_FAMILIES: ReadonlyMap<string, string> = new Map(
  CAPTION_FONT_FILES.map((file) => [file.family.toLowerCase(), file.fontId]),
);
const GENERIC = new Set(['sans-serif', 'serif', 'monospace', 'system-ui', 'cursive']);

/** A font-family list's names, unquoted, or null when it is no plain list. */
export function familyNames(value: string): string[] | null {
  const names: string[] = [];
  for (const raw of value.split(',')) {
    const part = raw.trim();
    const quoted = /^"([^"\\]{1,40})"$|^'([^'\\]{1,40})'$/.exec(part);
    if (quoted) names.push((quoted[1] ?? quoted[2] ?? '').trim());
    else if (/^[A-Za-z][A-Za-z0-9 -]{0,40}$/.test(part)) names.push(part.replace(/\s+/g, ' '));
    else return null;
  }
  return names;
}

/** The first bundled font a font-family list names, or why the list is refused. */
export function curatedFont(value: string): { font: string } | { problem: string } {
  const names = familyNames(value);
  if (!names) return { problem: 'is not a list of font names' };
  for (const name of names) {
    const font = CURATED_FAMILIES.get(name.toLowerCase());
    if (font) return { font };
    if (!GENERIC.has(name.toLowerCase())) return { problem: `names ${name}, which is not a bundled font` };
  }
  return { problem: 'names no bundled font' };
}

function declarationProblem(property: string, value: string, context: ValueContext): string | null {
  if (property.startsWith('--')) return `sets ${property} (variables are the composition’s, set by Taalcut)`;
  if (property === 'font-family') {
    const found = curatedFont(value);
    return 'problem' in found ? `font-family: ${value.slice(0, 40)} ${found.problem}` : null;
  }
  if (property === 'position' && value.trim() === 'fixed') return 'position: fixed';
  return declarationProblemIn(WORKSPACE_PROPERTIES, property, value, {
    ...context,
    units: WORKSPACE_UNITS,
    functions: WORKSPACE_FUNCTIONS,
  });
}

const PSEUDO =
  /^:(?:first-child|last-child|only-child|first-of-type|last-of-type|(?:nth-child|nth-of-type)\((?:odd|even|\d{1,2}|\d{0,2}n(?:\s*[+-]\s*\d{1,2})?)\))/;
const ATTRIBUTE = /^\[data-[a-z][a-z0-9-]{0,40}(?:="[A-Za-z0-9_-]{0,24}")?\]/;

/** Why a compound selector is refused, or null. */
function compoundProblem(compound: string): string | null {
  let rest = compound;
  const tag = /^[a-z][a-z0-9]*/i.exec(rest);
  if (tag) {
    if (!WORKSPACE_TAGS.has(tag[0].toLowerCase())) return `names the tag ${tag[0]}`;
    rest = rest.slice(tag[0].length);
  } else if (rest.startsWith('*')) rest = rest.slice(1);
  while (rest.length > 0) {
    const name = /^[#.]([A-Za-z_][A-Za-z0-9_-]*)/.exec(rest);
    if (name) {
      if (!NAME.test(name[1] ?? '') && !/^_[A-Za-z0-9_-]{0,47}$/.test(name[1] ?? ''))
        return `names ${name[0]}`;
      rest = rest.slice(name[0].length);
      continue;
    }
    const part = PSEUDO.exec(rest) ?? ATTRIBUTE.exec(rest);
    if (part) {
      rest = rest.slice(part[0].length);
      continue;
    }
    if (/^::(?:before|after)$/.test(rest)) return null;
    return `has "${rest.slice(0, 20)}"`;
  }
  return null;
}

/** Why a selector list is refused, or null (DSG1's shape: descendant, child and sibling combinators). */
export function workspaceSelectorProblem(selectors: string): string | null {
  if (selectors.length > 400) return 'is too long';
  for (const selector of selectors.split(',')) {
    const parts = selector
      .trim()
      .replace(/\s*([>+~])\s*/g, ' $1 ')
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length === 0) return 'is empty';
    if (parts.length > 9) return 'is too deep';
    for (const [index, part] of parts.entries()) {
      if (part === '>' || part === '+' || part === '~') {
        if (index === 0 || index === parts.length - 1) return `starts or ends with ${part}`;
        continue;
      }
      if (part.includes('::') && index !== parts.length - 1) return 'puts a pseudo-element before the end';
      const problem = compoundProblem(part);
      if (problem) return problem;
    }
  }
  return null;
}

export const WORKSPACE_CSS: CssRules = {
  declarationProblem,
  selectorProblem: (selectors) => workspaceSelectorProblem(selectors),
  maxRules: 240,
};

/** The fix hint for a CSS problem the parser reports. */
export function cssFixHint(problem: string): string {
  if (problem.includes('at-rule'))
    return 'Remove @-rules: the bundled fonts are loaded by Taalcut, and motion is the GSAP timeline, not @keyframes.';
  if (problem.includes('font-family'))
    return `Use a bundled font: ${[...new Set(CAPTION_FONT_FILES.map((file) => file.family))].join(', ')}.`;
  if (problem.includes('url'))
    return 'Load only a file the workspace holds, by its sha256: url(assets/<sha256>) or <img src="assets/<sha256>">; no other URL, data: URI or font file.';
  if (problem.includes('transition') || problem.includes('animation'))
    return 'Animate with tweens on the one paused timeline instead of CSS transitions or animations.';
  if (problem.includes('unit'))
    return 'Use px, %, em, rem, deg or fr; the viewport units depend on the player.';
  if (problem.includes('sets --'))
    return 'Declare the value as a composition variable (data-composition-variables) and read it with var(--name).';
  if (problem.includes('variable that is not'))
    return 'Read only declared colour or number variables with var(--name).';
  return 'Write the rule with plain properties and literal values from the allowed set.';
}
