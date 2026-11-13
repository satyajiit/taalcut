// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-UI: what a designed graphic shows, read from the timeline it is on. A graphic drawn with a composition names
 * a copy in the timeline's `graphicCompositions` (core's compositionFor, here without core's runtime: the kit
 * imports core's types only); each of its variables has the graphic's own value, else the variable's default (a
 * text's sample). Pure, for the cards, the editor's inspector and their tests.
 */
import type {
  GraphicComposition,
  GraphicItem,
  GraphicParam,
  GraphicParamValues,
  Timeline,
} from '@taalcut/core';

export type DesignValue = string | number | boolean;

/** The copy a graphic is drawn with; null for a kit graphic, or a copy the timeline doesn't hold. */
export function designOf(
  timeline: Pick<Timeline, 'graphicCompositions'> | null | undefined,
  item: Pick<GraphicItem, 'composition'> | null | undefined,
): GraphicComposition | null {
  const ref = item?.composition;
  if (!ref || !timeline) return null;
  return timeline.graphicCompositions?.find((copy) => copy.id === ref.id && copy.hash === ref.hash) ?? null;
}

/** A variable's value when the graphic sets none. */
export function defaultOf(variable: GraphicParam): DesignValue {
  return variable.type === 'text' ? variable.sample : variable.default;
}

/** Each variable's value now, by name: the graphic's own (when it is the variable's type), else the default. */
export function designValues(
  variables: readonly GraphicParam[],
  params: GraphicParamValues | undefined,
): Record<string, DesignValue> {
  const values: Record<string, DesignValue> = {};
  for (const variable of variables) {
    const own = params?.[variable.name];
    values[variable.name] = sameType(variable, own) ? own : defaultOf(variable);
  }
  return values;
}

function sameType(variable: GraphicParam, value: unknown): value is DesignValue {
  switch (variable.type) {
    case 'text':
    case 'colour':
      return typeof value === 'string';
    case 'enum':
      return typeof value === 'string' && variable.options.includes(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
  }
}

/**
 * A variable's name as words: the designing model's identifier split where its words meet ("accentColour" →
 * "Accent colour", "line2" → "Line 2"). It is the model's, so it is shown as content, never translated.
 */
export function variableWords(name: string): string {
  const spaced = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
