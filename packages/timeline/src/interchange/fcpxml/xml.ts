// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The XML Taalcut writes and reads back (FCPXML): elements with attributes and child elements, no text nodes,
 * no namespaces. Written with every attribute escaped (names with `&`, `<`, quotes, newlines and any script are
 * safe) and read back by a small parser that accepts exactly that shape. No dependency.
 */
import { err, ok, ValidationError, type Result } from '@taalcut/core';

export interface XmlNode {
  readonly name: string;
  /** In the order written; the writer keeps it, so output is deterministic. */
  readonly attrs: readonly (readonly [string, string])[];
  readonly children: readonly XmlNode[];
}

/** An element; attributes whose value is null or undefined are left out. */
export function element(
  name: string,
  attrs: Readonly<Record<string, string | null | undefined>>,
  children: readonly XmlNode[] = [],
): XmlNode {
  const kept = Object.entries(attrs).flatMap(([key, value]) =>
    value === null || value === undefined ? [] : [[key, value] as const],
  );
  return { name, attrs: kept, children };
}

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/** An attribute value: markup characters as entities, line breaks and tabs as character references. */
export function escapeAttribute(value: string): string {
  // Control characters other than tab and line breaks aren't allowed in XML 1.0 at all: they go.
  const clean = [...value]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
    })
    .join('');
  return clean
    .replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char)
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
    .replace(/\t/g, '&#9;');
}

function write(node: XmlNode, depth: number, out: string[]): void {
  const pad = '  '.repeat(depth);
  const attrs = node.attrs.map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`).join('');
  if (node.children.length === 0) {
    out.push(`${pad}<${node.name}${attrs}/>`);
    return;
  }
  out.push(`${pad}<${node.name}${attrs}>`);
  for (const child of node.children) write(child, depth + 1, out);
  out.push(`${pad}</${node.name}>`);
}

/** A whole document: declaration, DOCTYPE (no system id: validators take the DTD from outside) and the root. */
export function serializeXml(root: XmlNode, doctype: string): string {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', `<!DOCTYPE ${doctype}>`];
  write(root, 0, out);
  return `${out.join('\n')}\n`;
}

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescape(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, ref: string) => {
    if (ref.startsWith('#x')) return String.fromCodePoint(Number.parseInt(ref.slice(2), 16));
    if (ref.startsWith('#')) return String.fromCodePoint(Number.parseInt(ref.slice(1), 10));
    return ENTITIES[ref] ?? whole;
  });
}

const TAG = /<(\/?)([A-Za-z_][\w.-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*"[^"]*")*)\s*(\/?)>/y;
const ATTR = /([A-Za-z_][\w.:-]*)\s*=\s*"([^"]*)"/g;

interface OpenElement {
  readonly name: string;
  readonly attrs: [string, string][];
  readonly children: XmlNode[];
}

/** Where the parser is: the text, the position, the elements still open and the root once it closes. */
interface ParseState {
  readonly body: string;
  at: number;
  readonly stack: OpenElement[];
  root: XmlNode | null;
}

const fail = (state: ParseState, detail: string) =>
  err(ValidationError({ field: 'xml' }, { detail: `${detail} at ${state.at}` }));

/** The next tag after any white space; 'end' at the end of the text, null for anything that isn't a tag. */
function nextTag(state: ParseState): RegExpExecArray | null | 'end' {
  const space = /\s*/y;
  space.lastIndex = state.at;
  space.exec(state.body);
  state.at = space.lastIndex;
  if (state.at >= state.body.length) return 'end';
  TAG.lastIndex = state.at;
  const match = TAG.exec(state.body);
  if (match) state.at = TAG.lastIndex;
  return match;
}

/** A finished element joins its parent, or is the root. */
function attach(state: ParseState, node: XmlNode): void {
  const parent = state.stack.at(-1);
  if (parent) parent.children.push(node);
  else state.root = node;
}

function attributes(raw: string): [string, string][] {
  return [...raw.matchAll(ATTR)].map((entry): [string, string] => [entry[1] ?? '', unescape(entry[2] ?? '')]);
}

/** Opens, closes or adds (self-closing) the element a tag names. */
function applyTag(state: ParseState, match: RegExpExecArray): Result<void> {
  const [, closing, name = '', rawAttrs = '', selfClosing] = match;
  if (closing) {
    const open = state.stack.pop();
    if (open?.name !== name) return fail(state, `Unbalanced </${name}>`);
    attach(state, { name, attrs: open.attrs, children: open.children });
    return ok(undefined);
  }
  const attrs = attributes(rawAttrs);
  if (selfClosing) attach(state, { name, attrs, children: [] });
  else state.stack.push({ name, attrs, children: [] });
  return ok(undefined);
}

/** Reads XML of the shape `serializeXml` writes; anything else is core.validation. */
export function parseXml(text: string): Result<XmlNode> {
  const body = text.replace(/^\uFEFF?<\?xml[^>]*\?>\s*/, '').replace(/^<!DOCTYPE[^>]*>\s*/, '');
  const state: ParseState = { body, at: 0, stack: [], root: null };
  for (let tag = nextTag(state); tag !== 'end'; tag = nextTag(state)) {
    if (!tag) return fail(state, 'Unexpected content');
    const applied = applyTag(state, tag);
    if (!applied.ok) return applied;
  }
  if (state.stack.length > 0 || !state.root) return fail(state, 'Unclosed element');
  return ok(state.root);
}

/** An attribute's value, or null. */
export function attr(node: XmlNode, name: string): string | null {
  return node.attrs.find(([key]) => key === name)?.[1] ?? null;
}
