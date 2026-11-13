// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Markup in a workspace composition's HTML (SPEC HFW1 gate): a subset of HTML and inline SVG the caller's rules
 * allow (gate/markup-rules.ts), parsed into a tree and written again by Taalcut's own serializer, so nothing the
 * model wrote reaches a page as it wrote it. No comment, script or entity other than the five basic ones; every
 * value is escaped.
 */
import { escapeHtml } from '../../compile/html';

export interface MarkupNode {
  readonly tag: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly (MarkupNode | string)[];
}

const HTML_TAGS = ['div', 'span', 'p', 'b', 'i', 'em', 'strong'];
const SVG_TAGS = ['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'];
export const ALLOWED_TAGS: ReadonlySet<string> = new Set([...HTML_TAGS, ...SVG_TAGS]);
/** `data-if`: a flag (`typing`), its negation (`!typing`), or an option (`side:left`). */
const CONDITION = /^(!?)([a-z][a-zA-Z0-9]{0,23})(?::([a-z][a-zA-Z0-9-]{0,23}))?$/;

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };

export interface MarkupLimits {
  readonly nodes: number;
  readonly depth: number;
}

/** What a parse allows: the workspace gate's rules (workspace/gate/markup-rules.ts). */
export interface MarkupRules {
  readonly tags: ReadonlySet<string>;
  /** Elements with no children that may still be closed by their own end tag (SVG shapes). */
  readonly leaves: ReadonlySet<string>;
  /** HTML void elements: never closed, written without an end tag. */
  readonly voids: ReadonlySet<string>;
  readonly attributeProblem: (tag: string, name: string, value: string) => string | null;
  /** The longest run of fixed words. */
  readonly maxText: number;
  /** Keep text as written, white space included (a page lays out its spaces); otherwise trimmed. */
  readonly keepSpace: boolean;
}

type Parsed = { ok: true; nodes: MarkupNode[] } | { ok: false; problem: string };

function decodeText(text: string): string | null {
  let bad = false;
  const decoded = text.replace(/&([a-z0-9#]+);/gi, (_, name: string) => {
    const value = ENTITIES[name.toLowerCase()];
    if (value === undefined) bad = true;
    return value ?? '';
  });
  return bad || /&/.test(text.replace(/&(?:amp|lt|gt|quot|#39);/gi, '')) ? null : decoded;
}

/** Parses the subset; refuses anything outside it with the first problem found. */
export function parseMarkup(source: string, limits: MarkupLimits, rules: MarkupRules): Parsed {
  const root: { tag: string; attributes: Record<string, string>; children: (MarkupNode | string)[] } = {
    tag: '#root',
    attributes: {},
    children: [],
  };
  const stack = [root];
  let count = 0;
  const pattern =
    /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z][a-zA-Z0-9-]*(?:="[^"<>]*")?)*)\s*(\/?)>|([^<]+)|(<)/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const [whole, rawTag, rawAttributes, selfClosing, text, stray] = match;
    const parent = stack[stack.length - 1]!;
    if (stray)
      return {
        ok: false,
        problem: `a "<" that opens no allowed tag near "${source.slice(match.index, match.index + 24)}"`,
      };
    if (text !== undefined) {
      if (text.trim() === '' && !rules.keepSpace) continue;
      const decoded = decodeText(text);
      if (decoded === null)
        return { ok: false, problem: 'an entity other than &amp; &lt; &gt; &quot; &#39;' };
      if (decoded.trim().length > rules.maxText)
        return { ok: false, problem: `fixed words longer than ${rules.maxText} characters` };
      parent.children.push(rules.keepSpace ? decoded : decoded.trim());
      continue;
    }
    const tag = (rawTag ?? '').toLowerCase();
    if (!rules.tags.has(tag)) return { ok: false, problem: `the tag <${tag}>` };
    if (whole.startsWith('</')) {
      if (rules.voids.has(tag)) return { ok: false, problem: `</${tag}> closes an element that has no end` };
      if (parent.tag !== tag) return { ok: false, problem: `</${tag}> closes <${parent.tag}>` };
      stack.pop();
      continue;
    }
    const attributes: Record<string, string> = {};
    for (const attribute of (rawAttributes ?? '').matchAll(/([a-zA-Z][a-zA-Z0-9-]*)(?:="([^"]*)")?/g)) {
      const name = attribute[1] ?? '';
      const value = attribute[2] ?? '';
      if (Object.hasOwn(attributes, name)) return { ok: false, problem: `${name} twice on <${tag}>` };
      const problem = rules.attributeProblem(tag, name, value);
      if (problem) return { ok: false, problem: `<${tag}> has ${problem}` };
      attributes[name] = value;
    }
    count += 1;
    if (count > limits.nodes) return { ok: false, problem: `more than ${limits.nodes} elements` };
    const node = { tag, attributes, children: [] as (MarkupNode | string)[] };
    parent.children.push(node);
    if (rules.voids.has(tag)) continue;
    if (!selfClosing && !rules.leaves.has(tag)) {
      stack.push(node);
      if (stack.length - 1 > limits.depth) return { ok: false, problem: `deeper than ${limits.depth}` };
    } else if (!selfClosing && rules.leaves.has(tag)) {
      // An SVG shape written <path ...></path>: accept its closing tag as the end of it.
      stack.push(node);
    }
  }
  if (stack.length !== 1) return { ok: false, problem: `<${stack[stack.length - 1]!.tag}> is never closed` };
  return { ok: true, nodes: root.children.filter((child): child is MarkupNode => typeof child !== 'string') };
}

/** Every node of a tree, depth first. */
export function* walk(nodes: readonly (MarkupNode | string)[]): Generator<MarkupNode> {
  for (const node of nodes) {
    if (typeof node === 'string') continue;
    yield node;
    yield* walk(node.children);
  }
}

export interface BindValues {
  /** Whether a `data-if` condition holds. */
  readonly condition: (negate: boolean, name: string, option: string | undefined) => boolean;
  /** A text slot's content as markup (escaped lines or split units). */
  readonly text: (node: MarkupNode) => string;
  /** HFW1: the attributes an element is written with (default: its own, without DSG1's bindings). */
  readonly attributes?: (node: MarkupNode) => readonly (readonly [name: string, value: string])[];
  /** HFW1: an element's content as markup instead of its children's, or undefined for its children's. */
  readonly content?: (node: MarkupNode) => string | undefined;
  /** HFW1: elements written without an end tag. */
  readonly voids?: ReadonlySet<string>;
}

const ownAttributes = (node: MarkupNode) =>
  Object.entries(node.attributes).filter(([name]) => name !== 'data-if' && name !== 'data-split');

/** The tree written as markup: conditions applied, text slots filled, every value escaped. */
export function serialize(nodes: readonly (MarkupNode | string)[], bind: BindValues): string {
  return nodes
    .map((node) => {
      if (typeof node === 'string') return escapeHtml(node);
      const condition = node.attributes['data-if'];
      if (condition) {
        const [, negate, name, option] = CONDITION.exec(condition) ?? [];
        if (!bind.condition(negate === '!', name ?? '', option)) return '';
      }
      const attributes = (bind.attributes ? bind.attributes(node) : ownAttributes(node))
        .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
        .join('');
      if (bind.voids?.has(node.tag)) return `<${node.tag}${attributes}>`;
      const inner =
        bind.content?.(node) ??
        (node.attributes['data-text'] ? bind.text(node) : serialize(node.children, bind));
      return `<${node.tag}${attributes}>${inner}</${node.tag}>`;
    })
    .join('');
}
