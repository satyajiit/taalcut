// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT1: an id the model copied wrong, mended to the run's own (SPEC section 38). On the owner's reel the 9B sent
 * setIntents `breakdownId: "01M6AB1W3T34N3T7Z89GD8PB4"`, the breakdown's id with one character dropped, and was
 * refused with "must match pattern". An id-shaped string that is not a valid id is mended to the one id the run's
 * tools returned within two edits of it (or the same id in lower case); with none, or two, the call goes as it was
 * and is refused as before. A valid id is never changed, even one the run hasn't seen: ids made together are one
 * or two edits apart (a monotonic ULID factory), so an unseen valid id can't be told from a miscopy. EDT1-GFX tried
 * mending one and it turned gaps/add-clips' answered asset and shot into their neighbours (SPEC section 38); a
 * not-found refusal names the near id instead (`notFoundHint`).
 */
import { NotFoundError, type TaalcutError } from '@taalcut/core';
import type { RunState } from '../run-state';

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/u;
/** Strings that look like an id the model mangled: no spaces, Crockford-ish, about an id's length. */
const ID_LIKE = /^[0-9A-Za-z]{23,29}$/u;
const MAX_EDITS = 2;
/** How deep into tool outputs and inputs ids are looked for. */
const DEPTH = 6;

function idsIn(value: unknown, depth: number, into: Set<string>): void {
  if (depth < 0 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (ULID.test(value)) into.add(value);
    return;
  }
  if (Array.isArray(value)) for (const item of value) idsIn(item, depth - 1, into);
  else if (typeof value === 'object')
    for (const item of Object.values(value as Record<string, unknown>)) idsIn(item, depth - 1, into);
}

/** The ids the run started with (its project, the ids in its message and plan) and its tools returned or took. */
export function knownIds(state: RunState): Set<string> {
  const ids = new Set<string>();
  // r1: the 9B's first call copied the project's id with a character added.
  idsIn(state.started?.projectId, 0, ids);
  for (const chip of state.started?.selections ?? []) {
    if (chip.kind === 'asset') idsIn(chip.assetId, 0, ids);
  }
  for (const word of (state.started?.message ?? '').split(/[^0-9A-Z]+/u)) idsIn(word, 0, ids);
  idsIn(state.plan, DEPTH, ids);
  for (const id of state.toolCallOrder) {
    const call = state.toolCalls[id];
    if (call?.outcome?.kind !== 'completed') continue;
    idsIn(call.requested.input, DEPTH, ids);
    if (call.outcome.payload.output.kind === 'inline') idsIn(call.outcome.payload.output.value, DEPTH, ids);
  }
  return ids;
}

/** Levenshtein distance, stopping once it passes `limit`. */
function distance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      best = Math.min(best, current[j]!);
    }
    if (best > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length]!;
}

function mendId(value: string, known: ReadonlySet<string>): string | undefined {
  if (ULID.test(value) || !ID_LIKE.test(value)) return undefined;
  const upper = value.toUpperCase();
  if (known.has(upper)) return upper;
  const near = [...known].filter((id) => distance(upper, id, MAX_EDITS) <= MAX_EDITS);
  return near.length === 1 ? near[0] : undefined;
}

export interface MendedIds {
  readonly input: unknown;
  readonly mended: readonly { readonly from: string; readonly to: string }[];
}

/** The call's input with each mangled id mended, or undefined when there was none to mend. */
export function mendIds(input: unknown, known: ReadonlySet<string>): MendedIds | undefined {
  if (known.size === 0) return undefined;
  const mended: { from: string; to: string }[] = [];
  const walk = (value: unknown, depth: number): unknown => {
    if (typeof value === 'string') {
      const to = depth >= 0 ? mendId(value, known) : undefined;
      if (to === undefined) return value;
      mended.push({ from: value, to });
      return to;
    }
    if (depth < 0 || value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((item) => walk(item, depth - 1));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item, depth - 1)]));
  };
  const repaired = walk(input, DEPTH);
  return mended.length > 0 ? { input: repaired, mended } : undefined;
}

/**
 * EDT1-GFX: the words of a tool's `core.not_found` for an id, which said nothing before ("Error core.not_found"):
 * what wasn't found, and, for a valid id the run never saw, the one id it did see within two edits. On the eval the
 * 9B sent graphics.edit the timeline's id as its `projectId` and retried the bare refusal until it ran out of turns.
 * The near id is named, not put in the call: ids made together are one or two edits apart (a monotonic ULID
 * factory), so a valid id the run hasn't seen (from the person's answer, an earlier turn) can't be told from a
 * miscopy before the tool says it isn't there; then the model chooses.
 */
export function notFoundHint(error: TaalcutError, known: ReadonlySet<string>): TaalcutError {
  const params = (error.params ?? {}) as { entity?: unknown; id?: unknown };
  if (error.code !== NotFoundError.code || typeof params.id !== 'string' || !ULID.test(params.id))
    return error;
  const id = params.id;
  const near = known.has(id) ? [] : [...known].filter((other) => distance(id, other, MAX_EDITS) <= MAX_EDITS);
  // A tool's own words stand when there is no near id to add.
  if (error.detail && near.length !== 1) return error;
  const words = [
    error.detail || `No ${typeof params.entity === 'string' ? params.entity : 'thing'} has the id ${id}.`,
    near.length === 1
      ? `Did you mean ${near[0]}? It is the one id this run has seen within two characters of it.`
      : 'Pass each id exactly as the request or a tool gave it.',
  ];
  return { ...error, detail: words.join(' ') };
}
