// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG2: whether the designs of one set differ in a real way. Three designs for a job are three ideas, not one design
 * in three colours, so `workspace.placeOptions` reads each entry as three facets with its colours taken out: its type
 * (families, weights, case, spacing), its layout (the markup's shape and every other declaration, without the
 * colours) and its motion (the tweens, without the names they move). Two designs of a set must differ in at least
 * two of the three. It is a floor a tool can hold, not a judgement of the designs: the Designer states each one's
 * idea, and this refuses a set that is the same design with a new coat.
 */

export interface DesignFacets {
  readonly type: string;
  readonly layout: string;
  readonly motion: string;
}

export const FACETS = ['type', 'layout', 'motion'] as const;
export type Facet = (typeof FACETS)[number];

/** The declarations that say how the type is set. */
const TYPE_PROPERTY =
  /^(font(-family|-weight|-style|-stretch|-variant[a-z-]*|-feature-settings)?|text-transform|letter-spacing|word-spacing)$/;
/** The declarations that only carry a colour: left out of every facet. */
const COLOUR_PROPERTY =
  /^(color|background-color|border(-top|-right|-bottom|-left)?-color|outline-color|fill|stroke|text-decoration-color|caret-color|accent-color|stop-color|flood-color)$/;
/** Shorthands that mix a colour with a shape: only their numbers are kept. */
const MIXED_PROPERTY =
  /^(background|background-image|border(-top|-right|-bottom|-left)?|outline|box-shadow|text-shadow|filter|text-decoration|-webkit-text-stroke)$/;

const between = (html: string, open: RegExp, close: RegExp): string => {
  const start = open.exec(html);
  if (!start) return '';
  const rest = html.slice(start.index + start[0].length);
  const end = close.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
};

const squeeze = (text: string) => text.replace(/\s+/g, ' ').trim();

/** A colour written as a function or a variable: `rgba(…)`, `oklch(…)`, `var(--accent)`. */
const COLOUR_FUNCTION =
  /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|var)\([^()]*(\([^()]*\)[^()]*)*\)/gi;

/** A value's numbers with their units, in order ("0 2px 6px"): the shape of a shadow or a border, not its colour. */
const numbersOf = (value: string) =>
  (
    value
      .replace(COLOUR_FUNCTION, ' ')
      .replace(/#[0-9a-f]{3,8}\b/gi, ' ')
      .match(/-?\d*\.?\d+[a-z%]*/gi) ?? []
  ).join(' ');

/** A design's CSS as `property:value` lines, split into the type's and everything else's, colours out. */
function declarations(css: string): { type: string[]; rest: string[] } {
  const type: string[] = [];
  const rest: string[] = [];
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  for (const rule of plain.split('}')) {
    const body = rule.slice(rule.indexOf('{') + 1);
    for (const declaration of body.split(';')) {
      const at = declaration.indexOf(':');
      if (at < 0) continue;
      const property = declaration.slice(0, at).trim().toLowerCase();
      const value = squeeze(declaration.slice(at + 1)).toLowerCase();
      if (!property || !value || property.startsWith('--') || COLOUR_PROPERTY.test(property)) continue;
      if (TYPE_PROPERTY.test(property)) type.push(`${property}:${value}`);
      else rest.push(`${property}:${MIXED_PROPERTY.test(property) ? numbersOf(value) : value}`);
    }
  }
  return { type: [...new Set(type)].sort(), rest: rest.sort() };
}

/** The markup's shape: its tags in order with their depth, no names, no words. */
function skeleton(markup: string): string {
  const tags: string[] = [];
  let depth = 0;
  for (const tag of markup.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b[^>]*?(\/?)>/gi)) {
    const [, closing, name, selfClosing] = tag;
    if (closing) depth = Math.max(0, depth - 1);
    else {
      tags.push(`${depth}${name!.toLowerCase()}`);
      if (
        !selfClosing &&
        !/^(br|img|hr|input|meta|path|circle|rect|line|polyline|polygon|ellipse|use)$/i.test(name!)
      )
        depth += 1;
    }
  }
  return tags.join(' ');
}

/** The script's tweens in order, without the names they move (a renamed class is not another motion). */
function tweens(script: string): string {
  return script
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^tl\.(to|from|fromTo|set)\(/.test(line))
    .map((line) => line.replace(/^(tl\.[a-zA-Z]+\()\s*(['"`]).*?\2\s*,?/, '$1').replace(/\s+/g, ''))
    .join('\n');
}

/** The three facets of a composition's entry file. */
export function facetsOf(html: string): DesignFacets {
  const template = between(html, /<template\b[^>]*>/i, /<\/template>/i) || html;
  const css = between(template, /<style\b[^>]*>/i, /<\/style>/i);
  const script = between(template, /<script\b[^>]*>/i, /<\/script>/i);
  const markup = template
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const { type, rest } = declarations(css);
  return { type: type.join(';'), layout: `${skeleton(markup)}|${rest.join(';')}`, motion: tweens(script) };
}

/** The facets two designs share. */
export function sharedFacets(a: DesignFacets, b: DesignFacets): Facet[] {
  return FACETS.filter((facet) => a[facet] === b[facet]);
}

/** How many facets two designs of a set may share at most (they differ in the other two). */
export const SHARED_FACETS_MAX = 1;

/**
 * Why these designs are not a set of different ideas, or null: the first pair that shares more than one facet, with
 * what they share and what to change.
 */
export function sameDesignProblem(
  entries: readonly { readonly entry: string; readonly html: string }[],
): string | null {
  const facets = entries.map((entry) => facetsOf(entry.html));
  for (let a = 0; a < facets.length; a += 1)
    for (let b = a + 1; b < facets.length; b += 1) {
      const shared = sharedFacets(facets[a]!, facets[b]!);
      if (shared.length <= SHARED_FACETS_MAX) continue;
      const differ = FACETS.filter((facet) => !shared.includes(facet));
      const only =
        differ.length > 0 ? `only their ${differ.join(' and ')} differs` : 'only their colours differ';
      return (
        `Options ${a + 1} and ${b + 1} (${entries[a]!.entry}, ${entries[b]!.entry}) share their ${shared.join(' and ')}: ` +
        `${only}. Each option is its own idea: give one of them another ${shared.join(' or another ')} ` +
        '(not a new colour), lint it and draw it again'
      );
    }
  return null;
}
