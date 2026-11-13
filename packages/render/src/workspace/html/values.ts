// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CSS values in a workspace composition's HTML (SPEC HFW1 gate): every value is tokenised and checked before it
 * reaches a page. Functions come from an allowlist (the caller may widen it: gate/css-rules.ts), `var` reads a
 * declared variable or Taalcut's box variables, `url()` only names what the caller allows, there is no string but
 * the empty one, and no escape. Lengths are px, %, em, deg, rad, turn or fr unless the caller allows other units:
 * nothing depends on the viewport or the clock.
 */

/** A token of a CSS value. */
export type ValueToken =
  | { readonly kind: 'number'; readonly value: number; readonly unit: string }
  | { readonly kind: 'hex'; readonly value: string }
  | { readonly kind: 'ident'; readonly value: string }
  | { readonly kind: 'function'; readonly name: string }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'punct'; readonly value: string };

export const VALUE_FUNCTIONS: ReadonlySet<string> = new Set([
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'var',
  'calc',
  'min',
  'max',
  'clamp',
  'linear-gradient',
  'radial-gradient',
  'conic-gradient',
  'repeating-linear-gradient',
  'translate',
  'translatex',
  'translatey',
  'scale',
  'scalex',
  'scaley',
  'rotate',
  'skew',
  'skewx',
  'skewy',
  'matrix',
  'blur',
  'drop-shadow',
  'brightness',
  'contrast',
  'saturate',
  'grayscale',
  'opacity',
  'inset',
  'circle',
  'ellipse',
  'polygon',
]);
export const VALUE_UNITS: ReadonlySet<string> = new Set(['', 'px', '%', 'em', 'deg', 'rad', 'turn', 'fr']);
/** Taalcut's own box variables (compile.ts sets them on the component's root). */
export const BOX_VARIABLES = [
  '--tc-w',
  '--tc-h',
  '--tc-text-x',
  '--tc-text-y',
  '--tc-text-w',
  '--tc-text-h',
  '--tc-line',
  '--tc-size',
] as const;

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i;

/** Splits a value into tokens; null when it holds anything a value may not (an escape, a quote left open). */
export function tokenize(value: string): ValueToken[] | null {
  const tokens: ValueToken[] = [];
  let rest = value.trim();
  while (rest.length > 0) {
    const space = /^\s+/.exec(rest);
    if (space) {
      rest = rest.slice(space[0].length);
      continue;
    }
    const number = NUMBER.exec(rest);
    if (number) {
      const unit = /^(%|[a-z]+)/i.exec(rest.slice(number[0].length))?.[0] ?? '';
      tokens.push({ kind: 'number', value: Number(number[0]), unit: unit.toLowerCase() });
      rest = rest.slice(number[0].length + unit.length);
      continue;
    }
    const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})(?![0-9a-z])/i.exec(rest);
    if (hex) {
      tokens.push({ kind: 'hex', value: hex[0].toLowerCase() });
      rest = rest.slice(hex[0].length);
      continue;
    }
    const ident = /^-{0,2}[a-z][a-z0-9-]*/i.exec(rest);
    if (ident) {
      const after = rest.slice(ident[0].length);
      if (after.startsWith('(')) {
        tokens.push({ kind: 'function', name: ident[0].toLowerCase() });
        rest = after.slice(1);
      } else {
        tokens.push({ kind: 'ident', value: ident[0] });
        rest = after;
      }
      continue;
    }
    const string = /^"([^"\\]*)"|^'([^'\\]*)'/.exec(rest);
    if (string) {
      tokens.push({ kind: 'string', value: string[1] ?? string[2] ?? '' });
      rest = rest.slice(string[0].length);
      continue;
    }
    const punct = /^[(),/*+-]/.exec(rest);
    if (punct) {
      tokens.push({ kind: 'punct', value: punct[0] });
      rest = rest.slice(1);
      continue;
    }
    return null;
  }
  return tokens;
}

export interface ValueContext {
  /** Parameters `var()` may read (colour and number params). */
  readonly variables: ReadonlySet<string>;
  /** HFW1: the units a value may use (default: DSG1's). */
  readonly units?: ReadonlySet<string>;
  /** HFW1: the functions a value may call (default: DSG1's). */
  readonly functions?: ReadonlySet<string>;
  /** HFW1: the files `url()` may load (a workspace asset's path); absent, no `url()` at all. */
  readonly assetUrl?: (path: string) => boolean;
}

const URL_CALL = /url\(\s*(['"]?)([^'"()\s]*)\1\s*\)/gi;

/** The value with each `url()` the context allows read as `none`, or the first path it refuses. */
function withoutAssetUrls(value: string, allowed: (path: string) => boolean): string | { refused: string } {
  let refused: string | undefined;
  const rest = value.replace(URL_CALL, (_call, _quote, path: string) => {
    if (!allowed(path)) refused ??= path;
    return 'none';
  });
  return refused === undefined ? rest : { refused };
}

/** Why a value is refused, or null when it may be drawn. */
export function valueProblem(written: string, context: ValueContext): string | null {
  const value = context.assetUrl ? withoutAssetUrls(written, context.assetUrl) : written;
  if (typeof value !== 'string') return `loads url(${value.refused.slice(0, 40)})`;
  if (/\\|url\s*\(|@|!important|<|>|expression|javascript:/i.test(value)) return 'holds a forbidden form';
  const tokens = tokenize(value);
  if (!tokens) return 'is not a CSS value';
  let depth = 0;
  for (const [index, token] of tokens.entries()) {
    switch (token.kind) {
      case 'function': {
        if (!(context.functions ?? VALUE_FUNCTIONS).has(token.name)) return `uses ${token.name}()`;
        if (token.name === 'var') {
          const name = tokens[index + 1];
          const known =
            name?.kind === 'ident' &&
            ((BOX_VARIABLES as readonly string[]).includes(name.value) ||
              (name.value.startsWith('--') && context.variables.has(name.value.slice(2))));
          if (!known) return 'reads a variable that is not a parameter';
        }
        depth += 1;
        break;
      }
      case 'punct':
        if (token.value === '(') return 'opens a bracket without a function';
        if (token.value === ')') depth -= 1;
        if (depth < 0) return 'closes a bracket it never opened';
        break;
      case 'number':
        if (!(context.units ?? VALUE_UNITS).has(token.unit)) return `uses the unit ${token.unit}`;
        if (Math.abs(token.value) > 20_000) return 'holds a number too large';
        break;
      case 'string':
        if (token.value !== '') return 'holds text (only "" is allowed)';
        break;
      case 'hex':
      case 'ident':
        break;
    }
  }
  return depth === 0 ? null : 'leaves a bracket open';
}
