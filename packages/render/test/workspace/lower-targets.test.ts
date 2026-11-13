// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Tween targets resolved against the composition's own markup (HFW1 lower), with the structural pseudo-classes
 * (HFW1 dsn): `:first-child`, `:last-child`, `:nth-child(n | odd | even)` and `:not(<compound>)` pick elements at
 * lower time, as a browser's querySelectorAll would; other pseudo-classes and sibling combinators stay refused.
 */
import { describe, expect, it } from 'vitest';
import type { MarkupNode } from '../../src/workspace/html/markup';
import { indexTargets, selectElements } from '../../src/workspace/lower/targets';

const el = (tag: string, attributes: Record<string, string> = {}, children: MarkupNode[] = []): MarkupNode => ({
  tag,
  attributes,
  children,
});

const root = el('div', { id: 'root' }, [
  el('ul', { class: 'list' }, [el('li', { id: 'a' }), el('li', { id: 'b', class: 'skip' }), el('li', { id: 'c' })]),
  el('p', { id: 'line' }),
]);

const ids = (selector: string) => selectElements(indexTargets(root), selector)?.map((node) => node.attributes.id ?? node.tag) ?? null;

describe('tween targets with structural pseudo-classes', () => {
  it('picks the first, last and nth child, and what a :not leaves', () => {
    expect(ids('.list li:first-child')).toEqual(['a']);
    expect(ids('li:last-child')).toEqual(['c']);
    expect(ids('.list > li:nth-child(2)')).toEqual(['b']);
    expect(ids('li:nth-child(odd)')).toEqual(['a', 'c']);
    expect(ids('li:nth-child(even)')).toEqual(['b']);
    expect(ids('li:not(.skip)')).toEqual(['a', 'c']);
    expect(ids('#root > :last-child')).toEqual(['line']);
    expect(ids('li:not(:first-child):not(:last-child)')).toEqual(['b']);
  });

  it('still refuses what it does not resolve', () => {
    for (const selector of ['li:hover', 'li:nth-of-type(1)', 'li:nth-child(2n+1)', 'li + li', 'li ~ li', 'li:not(.a .b)'])
      expect(ids(selector), selector).toBeNull();
  });
});
