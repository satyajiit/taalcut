// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Exact readback addresses use transcript ordinals, which survive resume and replay's fresh internal ids. */
import { wrapUntrusted } from '../prompt';
import type { RunState, TranscriptItem } from '../run-state';

type Turn = Extract<TranscriptItem, { kind: 'assistant' }>;
export interface ResultReference {
  readonly message: number;
  readonly content: string;
  /** Only successful read-only results may use this after a later model turn has seen the answer. */
  readonly consumed?: string;
}

export function loggedResult(state: RunState, id: string): { readonly value: unknown } | undefined {
  const match = /^result:(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(id);
  if (!match) return undefined;
  const turn = state.transcript.filter((item) => item.kind === 'assistant')[Number(match[1])];
  const callId = turn?.toolCallIds[Number(match[2])];
  const call = callId ? state.toolCalls[callId] : undefined;
  const outcome = call?.outcome;
  return !call?.requested.meta && outcome?.kind === 'completed' && outcome.payload.output.kind === 'inline'
    ? { value: outcome.payload.output.value }
    : undefined;
}

export function resultReferences(state: RunState, turn: Turn): ResultReference[] {
  const ordinal = state.transcript.filter((item) => item.kind === 'assistant').indexOf(turn);
  let message = 0;
  return turn.toolCallIds.flatMap((id, index) => {
    const call = state.toolCalls[id];
    if (!call?.outcome) return [];
    message++;
    const ref = `result:${ordinal}:${index}`;
    const found = loggedResult(state, ref);
    if (!found) return [];
    const bytes = new TextEncoder().encode(JSON.stringify(found.value) ?? 'null').byteLength;
    const read = call.requested.sideEffect === 'read';
    return [
      {
        message,
        content: resultReference(ref, bytes, found.value),
        ...(read
          ? {
              consumed: consumedReference(ref, bytes, found.value),
            }
          : {}),
      },
    ];
  });
}

function consumedReference(id: string, bytes: number, value: unknown): string {
  if (Array.isArray(value)) return resultReference(id, bytes, value);
  const entries =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value).filter(([, field]) => Array.isArray(field))
      : [];
  const receipt = `(application/json, ${bytes} bytes). Read earlier; readArtifact with this id/path rereads exact data.`;
  if (entries.length === 0) return `[Taalcut] Read result ${id} ${receipt}`;
  // Keep collection counts until a later decision records progress through them, including rerank pages.
  const fields = Object.fromEntries(entries.slice(0, 16).map(([key, field]) => [key, shape(field)]));
  return `Stored as result ${id} ${receipt} Only collection fields shown (${Math.min(entries.length, 16)} of ${entries.length}). Fields:\n${wrapUntrusted(JSON.stringify(fields), 'result-fields')}`;
}

function resultReference(id: string, bytes: number, value: unknown): string {
  const count =
    value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).length : 0;
  const fields =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value)
            .slice(0, 16)
            .map(([key, item]) => [key, shape(item)]),
        )
      : shape(value);
  return `Stored as result ${id} (application/json, ${bytes} bytes). Call readArtifact with this id and a JSON Pointer path to read exact sections.${count > 16 ? ` Showing the first 16 of ${count} fields.` : ''} Fields:\n${wrapUntrusted(JSON.stringify(fields), 'result-fields')}`;
}

const shape = (value: unknown): string =>
  Array.isArray(value) ? `array(${value.length})` : value === null ? 'null' : typeof value;

/**
 * Only successful reader outputs are receipts; the latest turn's page has not been read yet. A stored artifact's
 * page read with no path is one too: 0.1.0-beta.1's installed run read the editor's stored timeline twice running,
 * both pages stayed whole beside the editor's prompt, and the edit ended with models.context_too_long.
 */
export function readPages(state: RunState, turn: Turn): ResultReference[] {
  let message = 0;
  return turn.toolCallIds.flatMap((id) => {
    const call = state.toolCalls[id];
    if (!call?.outcome) return [];
    message++;
    if (!(
      call.requested.meta &&
      call.requested.tool === 'readArtifact' &&
      call.outcome.kind === 'completed' &&
      call.outcome.payload.output.kind === 'inline' &&
      typeof call.outcome.payload.output.value === 'string'
    ))
      return [];
    const bytes = /(?:^|\n)Bytes (\d+)-(\d+) of \d+\.\n/u.exec(call.outcome.payload.output.value);
    if (!bytes) return [];
    return [
      {
        message,
        content: `[Taalcut] Read bytes ${bytes[1]}-${bytes[2]}. Reread exactly with this call's id/path, offset ${bytes[1]}, limit ${Number(bytes[2]) - Number(bytes[1])}.`,
      },
    ];
  });
}
