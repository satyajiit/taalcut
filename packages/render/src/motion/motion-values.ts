// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a value of each motion property may look like (SPEC G.2): numbers where GSAP takes numbers, and strings
 * of digits, units and Taalcut's own path data otherwise. tc.js checks every value against these patterns again
 * before GSAP sees it, so nothing but compile code's numbers and units can reach a style, and no string can be
 * read as a selector, a URL or markup. One table, used by both sides.
 */
import type { MotionProperty } from './motion-data';

const number = '-?\\d+(?:\\.\\d+)?(?:e-?\\d+)?';
const length = `${number}(?:px|%|em)?`;
const colour = '(?:#[0-9a-fA-F]{3,8}|rgba?\\([\\d.,\\s%]+\\)|transparent|inherit|currentcolor)';
const pair = `${length} ${length}`;

/** SVG path data as Taalcut writes it: absolute commands, numbers, spaces and commas. */
export const PATH_DATA = '[MLHVCSQTAZ][MLHVCSQTAZ\\d\\s.,-]*';

/** A pattern per string-valued property; the others take finite numbers only. */
export const VALUE_PATTERNS: Readonly<Partial<Record<MotionProperty, string>>> = {
  transformOrigin: pair,
  objectPosition: pair,
  filter: `[a-z-]+\\(${length}\\)(?: [a-z-]+\\(${length}\\))*`,
  clipPath: `inset\\(${length}(?: ${length}){0,3}(?: round ${length})?\\)`,
  color: colour,
  backgroundColor: colour,
  boxShadow: `none|(?:inset )?${length}(?: ${length}){1,3} ${colour}`,
  drawSVG: `${length}(?: ${length})?`,
  morphSVG: PATH_DATA,
  width: length,
  height: length,
  borderRadius: `${length}(?: ${length}){0,3}`,
  letterSpacing: length,
  borderColor: colour,
};

/** Properties whose value is a number. */
export const NUMBER_PROPERTIES: ReadonlySet<MotionProperty> = new Set([
  'opacity',
  'autoAlpha',
  'x',
  'y',
  'z',
  'xPercent',
  'yPercent',
  'scale',
  'scaleX',
  'scaleY',
  'rotation',
  'rotationX',
  'rotationY',
  'skewX',
  'skewY',
  'transformPerspective',
]);

/** Properties that take a finite number (pixels, or DrawSVG's share) as well as a string their pattern allows. */
export const NUMBER_OR_STRING_PROPERTIES: ReadonlySet<MotionProperty> = new Set([
  'drawSVG',
  'width',
  'height',
  'borderRadius',
  'letterSpacing',
]);

/** Whether a value may go to GSAP for `property` (motionPath is checked as a whole object). */
export function valueAllowed(property: MotionProperty, value: unknown): boolean {
  if (property === 'motionPath') {
    if (typeof value !== 'object' || value === null) return false;
    const path: unknown = Reflect.get(value, 'path');
    return (
      typeof path === 'string' &&
      new RegExp(`^${PATH_DATA}$`).test(path) &&
      typeof Reflect.get(value, 'autoRotate') === 'boolean' &&
      Number.isFinite(Reflect.get(value, 'start')) &&
      Number.isFinite(Reflect.get(value, 'end'))
    );
  }
  if (NUMBER_PROPERTIES.has(property)) return typeof value === 'number' && Number.isFinite(value);
  if (typeof value === 'number') return NUMBER_OR_STRING_PROPERTIES.has(property) && Number.isFinite(value);
  const pattern = VALUE_PATTERNS[property];
  return typeof value === 'string' && pattern !== undefined && new RegExp(`^(?:${pattern})$`).test(value);
}
