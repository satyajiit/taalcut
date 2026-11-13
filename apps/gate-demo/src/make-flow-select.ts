// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Exact, purpose-sized reads whose progress lives only in the model's visible request. */
import { createHash } from 'node:crypto';
import { resultJson, untrustedBlock, type RequestView, type ToolCall } from './anthropic-view';
import type { DemoTurn } from './script';

type Json = Record<string, unknown>;
export type Selected = { json: Json; note?: string; turn?: undefined } | { turn: DemoTurn };
const FACTS = '[stand-in facts] ';
const PARTIAL = '[stand-in selected page] ';
const SOURCE = /^(?:Stored as (?:artifact|result)|\[Taalcut\] Read result) (\S+) /;
const PAGE = /^Bytes (\d+)-(\d+) of (\d+)\.\n<untrusted source="artifact">\n([\s\S]*)\n<\/untrusted>$/;
const object = (value: unknown): Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};

export function notes(view: RequestView, prefix: string): Json[] {
  return (view.notes ?? []).flatMap((text) =>
    text.split('\n').flatMap((line) => {
      const value = line.startsWith(prefix) ? resultJson(line.slice(prefix.length)) : null;
      return value ? [value] : [];
    }),
  );
}

export function withNote(turn: DemoTurn, note?: string): DemoTurn {
  return note ? { ...turn, text: [turn.text, note].filter(Boolean).join('\n') } : turn;
}

export const withReads = (turn: DemoTurn, ...reads: readonly { note?: string }[]): DemoTurn =>
  withNote(
    turn,
    reads
      .map((read) => read.note)
      .filter(Boolean)
      .join('\n'),
  );

/** Stable within this step even if the original inline result later becomes a handle receipt. */
export function sourceOf(_view: RequestView, call: ToolCall): string {
  if (call.sourceKey) return call.sourceKey;
  const handle = SOURCE.exec(call.result)?.[1];
  if (handle) return handle;
  const observed = JSON.stringify({ name: call.name, input: call.input, result: call.result });
  return `${call.name}:${createHash('sha256').update(observed).digest('hex').slice(0, 20)}`;
}

function at(value: unknown, pointer: string): unknown {
  for (const part of pointer.split('/').slice(1)) {
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~');
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = (value as Json)[key];
  }
  return value;
}

function observed(value: unknown, result: string): unknown {
  if (typeof value === 'string') {
    const marker = /^\[untrusted[: ](\d+)\]$/.exec(value);
    return marker ? untrustedBlock(result, Number(marker[1])) : value;
  }
  if (Array.isArray(value)) return value.map((item) => observed(item, result));
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, observed(item, result)]));
  return value;
}

/** Collection counts are facts in the tool receipt; no absent count is guessed. */
export function collectionSize(view: RequestView, call: ToolCall, name: string): number | undefined {
  const value = resultJson(call.result)?.[name];
  if (Array.isArray(value)) return value.length;
  const fields = /<untrusted source="result-fields">\n([\s\S]*?)\n<\/untrusted>/.exec(call.result)?.[1];
  const count = /^array\((\d+)\)$/.exec(String(resultJson(fields ?? '')?.[name]))?.[1];
  const saved = notes(view, FACTS).findLast((note) => note.source === sourceOf(view, call));
  return count === undefined ? (object(saved?.counts)[name] as number | undefined) : Number(count);
}

/** Read named scalars or small receipt sections, never an unrelated whole result. */
export function selectFields(
  view: RequestView,
  call: ToolCall,
  fields: Readonly<Record<string, string>>,
): Selected {
  if (call.result.startsWith('Error ') || (!resultJson(call.result) && !SOURCE.test(call.result)))
    return { turn: { text: `I could not read ${call.name}: ${call.result.slice(0, 200)}` } };
  const source = sourceOf(view, call);
  const remembered = Object.assign(
    {},
    ...notes(view, FACTS)
      .filter((note) => note.source === source)
      .map((note) => object(note.values)),
  ) as Json;
  const values: Json = {};
  const json: Json = {};
  const checkpoint = () =>
    Object.keys(values).length > 0 ? `${FACTS}${JSON.stringify({ source, values })}` : undefined;
  for (const [key, path] of Object.entries(fields)) {
    if (Object.hasOwn(remembered, path)) {
      const saved = object(remembered[path]);
      values[path] = saved;
      json[key] = saved.present === true ? saved.value : undefined;
      continue;
    }
    const read = selection(view, call, source, path);
    if ('turn' in read) return { turn: withNote(read.turn, checkpoint()) };
    json[key] = read.value;
    // Large text is consumed for this decision, not duplicated into a permanent checkpoint.
    const fact = read.value === undefined ? { present: false } : { present: true, value: read.value };
    if (Buffer.byteLength(JSON.stringify(fact)) <= 512) values[path] = fact;
  }
  return { json, ...(checkpoint() ? { note: checkpoint() } : {}) };
}

function selection(
  view: RequestView,
  call: ToolCall,
  source: string,
  path: string,
): { value: unknown } | { turn: DemoTurn } {
  const inline = resultJson(call.result);
  if (inline) return { value: observed(at(inline, path), call.result) };
  const id = SOURCE.exec(call.result)?.[1];
  if (!id) return { turn: { text: `I could not read ${call.name}: ${call.result.slice(0, 200)}` } };
  const prior = notes(view, PARTIAL).findLast((note) => note.source === source && note.path === path);
  let text = typeof prior?.text === 'string' ? prior.text : '';
  let next = typeof prior?.next === 'number' ? prior.next : 0;
  let total = typeof prior?.total === 'number' ? prior.total : Infinity;
  const prefix = `JSON Pointer ${JSON.stringify(path)} from ${id}.\n`;
  for (const read of view.calls.slice(view.calls.indexOf(call) + 1)) {
    if (read.name !== 'readArtifact' || read.input.id !== id || read.input.path !== path) continue;
    if (read.result === `Error core.not_found: JSON Pointer ${JSON.stringify(path)} does not exist.`)
      return { value: undefined };
    if (read.result.startsWith('Error '))
      return { turn: { text: `I could not read ${call.name}: ${read.result}` } };
    if (!read.result.startsWith(prefix)) continue;
    const page = PAGE.exec(read.result.slice(prefix.length));
    if (!page || Number(page[1]) !== next) continue;
    text += page[4];
    next = Number(page[2]);
    total = Number(page[3]);
  }
  if (next >= total) {
    try {
      return { value: JSON.parse(text) as unknown };
    } catch {
      return { turn: { text: `I could not parse ${path} from ${call.name}.` } };
    }
  }
  if (Buffer.byteLength(text) > 4096)
    return { turn: { text: `The selected field ${path} is too large for this scripted decision.` } };
  return {
    turn: withNote(
      {
        toolCall: view.tools.includes('readArtifact')
          ? { name: 'readArtifact', args: { id, path, offset: next } }
          : { name: 'findTools', args: { query: 'readArtifact' } },
      },
      next > 0 ? `${PARTIAL}${JSON.stringify({ source, path, text, next, total })}` : undefined,
    ),
  };
}
