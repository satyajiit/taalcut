// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Makes a recorded model session replayable on another machine. Requests
 * carry values that differ on every run: the home folder in paths, and ids
 * (ULIDs) the library makes. The model only ever sees canonical stand-ins for
 * them (/Users/demo, and 00…01, 00…02 in order of appearance), so the
 * recording holds those, and each reply is mapped back to this run's values
 * before the agent sees it. Image data is left alone. Ids are numbered per
 * scope (scopedCanonicaliser): a session's whole process, or one ask, so an
 * ask replays the same whatever ran before it in the process.
 *
 * Ids are numbered only from text no cut reaches. The agent cuts each earlier
 * tool call in a conversation's history at a fixed length (and an over-long
 * earlier message, or a condensed result), and the values before an id (a
 * path, a time, a confidence) differ in length from run to run: the same
 * record keeps an id whole in one run and splits or drops it in the next. Had
 * that id taken a number, every id after it would shift by one, and a recorded
 * reply would name the wrong comment. An id seen only in cut text gets a
 * stand-in from its place there instead (C, which cut text, which id in it),
 * so what a cut kept never moves another id's number.
 */
import { ok } from '@taalcut/core';
import type { ModelClient, ModelRequest, ModelStream } from '@taalcut/models';

export const CANONICAL_HOME = '/Users/demo';

const ULID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/g;
/** An earlier tool call in the history (packages/agent history.ts), cut short or not: a record near the cut length is cut in some runs only. */
const EARLIER_CALL = /<untrusted source="earlier-tool-call">[\s\S]*?<\/untrusted>/g;
/** What the agent writes where it cut a text short (history.ts, context/compaction.ts). */
const CUT = ' […]';
/** Provider blobs that must reach the provider unchanged. */
const OPAQUE_KEYS = new Set([
  'data',
  'signature',
  'thinkingSignature',
  'thoughtSignature',
  'encrypted_content',
]);

export interface Canonicaliser {
  /** This run's values to canonical ones. */
  toCanonical<T>(value: T): T;
  /** Canonical values back to this run's. */
  fromCanonical<T>(value: T): T;
}

export function createCanonicaliser(home: string): Canonicaliser {
  const canonical = new Map<string, string>();
  const real = new Map<string, string>();
  const number = (id: string) => {
    if (real.has(id) || canonical.has(id)) return;
    const stand = String(canonical.size + 1).padStart(26, '0');
    canonical.set(id, stand);
    real.set(stand, id);
  };
  const toCanonical = <T>(value: T): T => {
    // First the numbers, from the text no cut reaches, in order of appearance; then every text, cut text too.
    mapStrings(value, (text) => {
      for (const piece of piecesOf(text.split(home).join(CANONICAL_HOME))) {
        if (!piece.cut) for (const id of piece.text.match(ULID) ?? []) number(id);
      }
      return text;
    });
    let cuts = 0;
    return mapStrings(value, (text) =>
      piecesOf(text.split(home).join(CANONICAL_HOME))
        .map((piece) => {
          if (!piece.cut) return piece.text.replace(ULID, (id) => canonical.get(id) ?? id);
          const cut = (cuts += 1);
          const seen: string[] = [];
          return piece.text.replace(ULID, (id) => {
            const known = canonical.get(id);
            if (known || real.has(id)) return known ?? id;
            if (!seen.includes(id)) seen.push(id);
            const place = seen.indexOf(id) + 1;
            const stand = `C${String(cut).padStart(22, '0')}${String(place).padStart(3, '0')}`;
            real.set(stand, id);
            return stand;
          });
        })
        .join(''),
    );
  };
  const from = (text: string) =>
    text
      .replace(ULID, (id) => real.get(id) ?? id)
      .split(CANONICAL_HOME)
      .join(home);
  return { toCanonical, fromCanonical: (value) => mapStrings(value, from) };
}

/** A text's pieces, in order: an earlier tool call in the history, or a whole text that ends cut short, is cut. */
function piecesOf(text: string): { text: string; cut: boolean }[] {
  if (text.trimEnd().endsWith(CUT)) return [{ text, cut: true }];
  const pieces: { text: string; cut: boolean }[] = [];
  let at = 0;
  for (const match of text.matchAll(EARLIER_CALL)) {
    if (match.index > at) pieces.push({ text: text.slice(at, match.index), cut: false });
    pieces.push({ text: match[0], cut: true });
    at = match.index + match[0].length;
  }
  if (at < text.length || pieces.length === 0) pieces.push({ text: text.slice(at), cut: false });
  return pieces;
}

/** The canonicaliser for one request, by its messages; the call's events and result go back through it. */
export type CanonicaliserFor = (messages: readonly unknown[]) => Canonicaliser;

/**
 * One canonicaliser per scope, each numbering its ids from 00…01. `scopeOf` names the scope of a request from
 * its messages' text (home paths already under /Users/demo); a request it can't place (a vision call) stays in
 * the scope of the request before. With a scope per ask, an ask's ids are numbered in the order its own requests
 * show them, as they were when it was recorded, also when it runs after other asks or resumes in a fresh
 * process (each request carries the run so far, ids in the order they came). An ask replays once per process.
 */
export function scopedCanonicaliser(
  home: string,
  scopeOf: (text: string) => string | undefined,
): CanonicaliserFor {
  const scopes = new Map<string, Canonicaliser>();
  let current = '';
  return (messages) => {
    current = scopeOf(JSON.stringify(messages).split(home).join(CANONICAL_HOME)) ?? current;
    let canon = scopes.get(current);
    if (!canon) {
      canon = createCanonicaliser(home);
      scopes.set(current, canon);
    }
    return canon;
  };
}

function mapStrings<T>(value: T, map: (text: string) => string): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return map(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v === null || typeof v !== 'object') return v;
    if ((v as { type?: unknown }).type === 'image') return v;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, OPAQUE_KEYS.has(k) ? x : walk(x)]));
  };
  return walk(value) as T;
}

/** A client whose model sees canonical values; its events and results come back with this run's. */
export function canonicalClient(
  inner: ModelClient,
  canonical: Canonicaliser | CanonicaliserFor,
): ModelClient {
  const stream = (request: ModelRequest): ModelStream => {
    const canon = typeof canonical === 'function' ? canonical(request.messages) : canonical;
    const call = inner.stream({ ...request, messages: canon.toCanonical(request.messages) });
    return {
      async *[Symbol.asyncIterator]() {
        for await (const event of call) yield canon.fromCanonical(event);
      },
      result: async () => {
        const result = await call.result();
        return result.ok ? ok(canon.fromCanonical(result.value)) : result;
      },
    };
  };
  return { stream, complete: (request) => stream(request).result() };
}
