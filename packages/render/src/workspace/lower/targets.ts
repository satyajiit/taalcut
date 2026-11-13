// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Tween targets as elements (HFW1 lower): a composition's selector strings matched against its own parsed markup,
 * as GSAP's `querySelectorAll` inside the composition would match them, in document order. tc.js targets elements
 * by id, so an element a selector reaches that has no id of its own gets one here (`_t<n>`, a form no authored id
 * can take). Ids, classes, tags, `[data-…]`, the descendant and child combinators, and the structural pseudo-classes
 * `:first-child`, `:last-child`, `:nth-child(n | odd | even)` and `:not(<compound>)`, each resolved to elements here
 * against the parsed markup (HFW1 dsn: the 9B targeted list items so); anything else is the lowering's to refuse.
 */
import type { MarkupNode } from '../html/markup';

interface Placed {
  readonly node: MarkupNode;
  readonly parent: Placed | null;
}

export interface TargetIndex {
  /** Every element under the root (the root included), in document order. */
  readonly elements: readonly Placed[];
  /** Ids given to targeted elements that had none. */
  readonly generated: Map<MarkupNode, string>;
}

export function indexTargets(root: MarkupNode): TargetIndex {
  const elements: Placed[] = [];
  const visit = (node: MarkupNode, parent: Placed | null) => {
    const placed = { node, parent };
    elements.push(placed);
    for (const child of node.children) if (typeof child !== 'string') visit(child, placed);
  };
  visit(root, null);
  return { elements, generated: new Map() };
}

const SIMPLE = String.raw`(?:[#.][A-Za-z_][A-Za-z0-9_-]*|\[data-[a-z][a-z0-9-]*(?:="[^"]*")?\])`;
const PSEUDO = String.raw`:(?:first-child|last-child|nth-child\((?:\d+|odd|even)\)|not\([^()\s,]+\))`;
const COMPOUND = new RegExp(String.raw`^([a-z][a-z0-9]*|\*)?(${SIMPLE}*)((?:${PSEUDO})*)$`, 'i');

/** Its place among its parent's elements, from 1, and how many there are (the root alone: 1 of 1). */
function positionOf(placed: Placed): { readonly at: number; readonly of: number } {
  const siblings = placed.parent
    ? placed.parent.node.children.filter((child): child is MarkupNode => typeof child !== 'string')
    : [placed.node];
  return { at: siblings.indexOf(placed.node) + 1, of: siblings.length };
}

/** Whether a structural pseudo-class holds for `placed`, or null when its argument is not a compound we take. */
function matchesPseudo(placed: Placed, pseudo: string): boolean | null {
  const { at, of } = positionOf(placed);
  if (pseudo === ':first-child') return at === 1;
  if (pseudo === ':last-child') return at === of;
  const nth = /^:nth-child\((\d+|odd|even)\)$/i.exec(pseudo)?.[1]?.toLowerCase();
  if (nth) return nth === 'odd' ? at % 2 === 1 : nth === 'even' ? at % 2 === 0 : at === Number(nth);
  const not = /^:not\((.+)\)$/i.exec(pseudo)?.[1];
  if (not === undefined) return null;
  const inner = matchesCompound(placed, not);
  return inner === null ? null : !inner;
}

function matchesCompound(placed: Placed, compound: string): boolean | null {
  const parsed = COMPOUND.exec(compound);
  if (!parsed) return null;
  const node = placed.node;
  const [, tag, rest, pseudos] = parsed;
  if (tag && tag !== '*' && node.tag !== tag.toLowerCase()) return false;
  const classes = (node.attributes.class ?? '').split(/\s+/);
  for (const part of (rest ?? '').match(/[#.][A-Za-z_][A-Za-z0-9_-]*|\[[^\]]+\]/g) ?? []) {
    if (part.startsWith('#') && node.attributes.id !== part.slice(1)) return false;
    if (part.startsWith('.') && !classes.includes(part.slice(1))) return false;
    if (part.startsWith('[')) {
      const [name, value] = part.slice(1, -1).split('=');
      const actual = node.attributes[name ?? ''];
      if (actual === undefined || (value !== undefined && actual !== value.slice(1, -1))) return false;
    }
  }
  for (const pseudo of (pseudos ?? '').match(new RegExp(PSEUDO, 'gi')) ?? []) {
    const holds = matchesPseudo(placed, pseudo);
    if (holds !== true) return holds;
  }
  return true;
}

/** Whether `placed` matches a selector's compounds (right to left), or null when a part is not supported. */
function matches(placed: Placed, parts: readonly string[]): boolean | null {
  const last = parts[parts.length - 1];
  if (last === undefined) return null;
  const own = matchesCompound(placed, last);
  if (own !== true) return own;
  if (parts.length === 1) return true;
  const combinator = parts[parts.length - 2];
  const before = combinator === '>' ? parts.slice(0, -2) : parts.slice(0, -1);
  if (combinator === '>') return placed.parent ? matches(placed.parent, before) : false;
  for (let ancestor = placed.parent; ancestor; ancestor = ancestor.parent) {
    const found = matches(ancestor, before);
    if (found !== false) return found;
  }
  return false;
}

/**
 * The elements a selector list matches, in document order (the root itself only by its own id), or null when it
 * uses a form this matcher does not take (a pseudo-class, a sibling combinator).
 */
export function selectElements(index: TargetIndex, selectors: string): MarkupNode[] | null {
  const lists = selectors.split(',').map((selector) =>
    selector
      .trim()
      .replace(/\s*>\s*/g, ' > ')
      .split(/\s+/)
      .filter(Boolean),
  );
  if (lists.some((parts) => parts.length === 0 || parts.includes('+') || parts.includes('~'))) return null;
  const found: MarkupNode[] = [];
  for (const placed of index.elements) {
    let hit = false;
    for (const parts of lists) {
      const result = matches(placed, parts);
      if (result === null) return null;
      hit ||= result;
    }
    if (hit) found.push(placed.node);
  }
  return found;
}

/** The ids of elements (giving each one without an id a generated one). */
export function idsOf(index: TargetIndex, nodes: readonly MarkupNode[]): string[] {
  return nodes.map((node) => {
    const own = node.attributes.id;
    if (own) return own;
    const known = index.generated.get(node);
    if (known) return known;
    const made = `_t${index.generated.size}`;
    index.generated.set(node, made);
    return made;
  });
}
