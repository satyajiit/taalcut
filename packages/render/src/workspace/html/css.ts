// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Styles in a workspace composition's HTML (SPEC HFW1 gate): plain rules only (no at-rule, so no `@import`,
 * `@font-face`, `@keyframes` or `@media`), selectors and an allowlist of properties the caller's rules check
 * (gate/css-rules.ts), and every value checked by values.ts. This is the base property table the gate widens.
 */
import { valueProblem, type ValueContext } from './values';

const KEYWORDS = (...words: string[]) => new RegExp(`^(?:${words.join('|')})$`);
const ANY: RegExp | null = null;

/** Allowed properties, with the keywords a property takes alone (null: any checked value). */
export const COMPONENT_PROPERTIES: Readonly<Record<string, RegExp | null>> = {
  position: KEYWORDS('absolute', 'relative', 'static'),
  display: KEYWORDS('block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'none'),
  visibility: KEYWORDS('visible', 'hidden'),
  overflow: KEYWORDS('visible', 'hidden', 'clip'),
  'box-sizing': KEYWORDS('border-box', 'content-box'),
  'z-index': /^\d{1,2}$/,
  'flex-direction': KEYWORDS('row', 'row-reverse', 'column', 'column-reverse'),
  'align-items': KEYWORDS('start', 'end', 'center', 'stretch', 'flex-start', 'flex-end', 'baseline'),
  'justify-content': KEYWORDS(
    'start',
    'end',
    'center',
    'space-between',
    'space-around',
    'flex-start',
    'flex-end',
  ),
  'text-align': KEYWORDS('left', 'right', 'center', 'start', 'end'),
  'mix-blend-mode': KEYWORDS('normal'),
  'stroke-linecap': KEYWORDS('butt', 'round', 'square'),
  'stroke-linejoin': KEYWORDS('miter', 'round', 'bevel'),
  'border-style': KEYWORDS('solid', 'dashed', 'dotted', 'none'),
  content: /^(?:""|''|none)$/,
  ...Object.fromEntries(
    [
      'left',
      'right',
      'top',
      'bottom',
      'inset',
      'width',
      'height',
      'min-width',
      'min-height',
      'max-width',
      'max-height',
      'margin',
      'margin-left',
      'margin-right',
      'margin-top',
      'margin-bottom',
      'padding',
      'padding-left',
      'padding-right',
      'padding-top',
      'padding-bottom',
      'gap',
      'flex',
      'flex-grow',
      'flex-shrink',
      'flex-basis',
      'background',
      'background-color',
      'border',
      'border-left',
      'border-right',
      'border-top',
      'border-bottom',
      'border-width',
      'border-color',
      'border-radius',
      'border-top-left-radius',
      'border-top-right-radius',
      'border-bottom-left-radius',
      'border-bottom-right-radius',
      'box-shadow',
      'text-shadow',
      'opacity',
      'color',
      'transform',
      'transform-origin',
      'translate',
      'scale',
      'rotate',
      'filter',
      'clip-path',
      'outline',
      'outline-offset',
      'fill',
      'stroke',
      'stroke-width',
      'stroke-dasharray',
      'stroke-dashoffset',
    ].map((property) => [property, ANY]),
  ),
};

export interface CssRule {
  readonly selectors: string;
  readonly declarations: readonly (readonly [property: string, value: string])[];
}

export type CssParse = { ok: true; rules: CssRule[] } | { ok: false; problems: string[] };

/** What a parse allows: the workspace gate's rules (gate/css-rules.ts). */
export interface CssRules {
  readonly declarationProblem: (property: string, value: string, context: ValueContext) => string | null;
  readonly selectorProblem: (selectors: string, attributes: ReadonlySet<string>) => string | null;
  readonly maxRules: number;
}

/** Why a declaration is refused by a property table, or null. */
export function declarationProblemIn(
  table: Readonly<Record<string, RegExp | null>>,
  property: string,
  value: string,
  context: ValueContext,
): string | null {
  if (!Object.hasOwn(table, property)) return `the property ${property}`;
  const keywords = table[property];
  if (keywords) return keywords.test(value.trim()) ? null : `${property}: ${value.slice(0, 40)}`;
  const problem = valueProblem(value, context);
  return problem ? `${property}: ${value.slice(0, 40)} ${problem}` : null;
}

/** Parses and checks the styles; every problem found (at most 12) when any. */
export function parseCss(
  source: string,
  context: ValueContext & { readonly attributes: ReadonlySet<string> },
  allow: CssRules,
): CssParse {
  const problems: string[] = [];
  const text = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
  if (/@|\\|<\/?style|<!--/i.test(text)) problems.push('an at-rule, escape or tag');
  const rules: CssRule[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let consumed = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (text.slice(consumed, match.index).trim() !== '') problems.push('text between rules');
    consumed = match.index + match[0].length;
    const selectors = (match[1] ?? '').trim();
    const selectorIssue = allow.selectorProblem(selectors, context.attributes);
    if (selectorIssue) problems.push(`selector "${selectors.slice(0, 40)}" ${selectorIssue}`);
    const declarations: [string, string][] = [];
    for (const raw of (match[2] ?? '').split(';')) {
      if (raw.trim() === '') continue;
      const colon = raw.indexOf(':');
      if (colon < 0) {
        problems.push(`"${raw.trim().slice(0, 30)}" is no declaration`);
        continue;
      }
      const property = raw.slice(0, colon).trim().toLowerCase();
      const value = raw.slice(colon + 1).trim();
      // A custom property may only be a parameter's: those are Taalcut's to set.
      const issue = allow.declarationProblem(property, value, context);
      if (issue) problems.push(`"${selectors.slice(0, 30)}" ${issue}`);
      else declarations.push([property, value]);
    }
    rules.push({ selectors, declarations });
  }
  if (text.slice(consumed).trim() !== '') problems.push('text after the last rule');
  if (rules.length > allow.maxRules) problems.push(`more than ${allow.maxRules} rules`);
  return problems.length > 0 ? { ok: false, problems: problems.slice(0, 12) } : { ok: true, rules };
}
