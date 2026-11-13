// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How the make flow's stand-in model reads a step's tool results (make-flow-script.ts, make-flow-gaps.ts): the
 * calls a step made, their JSON (a stored result page by page through readArtifact), and the next call to make,
 * loading a tool with findTools first when the step hasn't.
 */
import { type RequestView, type ToolCall } from './anthropic-view';
import { selectFields, type Selected } from './make-flow-select';
export { collectionSize, notes, sourceOf, withNote, withReads } from './make-flow-select';
import type { DemoTurn } from './script';

export const use = (name: string, args: Record<string, unknown>, text?: string): DemoTurn => ({
  ...(text ? { text } : {}),
  toolCall: { name, args },
});

export type Json = Record<string, unknown>;
export const record = (value: unknown): Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Calls this step made to a tool (by call name), oldest first. */
export const callsTo = (view: RequestView, name: string): ToolCall[] =>
  view.calls.filter((c) => c.name === name);

/** Read only the named fields needed for the next decision. */
export function readCall(
  view: RequestView,
  call: ToolCall | undefined,
  fields: Readonly<Record<string, string>>,
): Selected {
  return call ? selectFields(view, call, fields) : { json: {} };
}

/**
 * The last result of `name`: missing (not called yet), the turn that reads it
 * first (an artifact), or its JSON. A tool that answered with an error ends
 * the step with what it said, instead of calling it again and again.
 */
export function need(
  view: RequestView,
  name: string,
  fields: Readonly<Record<string, string>>,
): { missing: true } | Selected {
  const last = callsTo(view, name).at(-1);
  if (!last) return { missing: true };
  const read = readCall(view, last, fields);
  if (read.turn) return { turn: read.turn };
  if (read.json) return read;
  return { turn: { text: `I could not go on: ${name} answered ${last.result.slice(0, 300)}` } };
}

/** Calls `name` if the step offers it; otherwise loads it with findTools first. */
export function call(view: RequestView, name: string, args: Json, text?: string): DemoTurn {
  if (view.tools.includes(name)) return use(name, args, text);
  return use('findTools', { query: name.replace('_', '.') });
}
