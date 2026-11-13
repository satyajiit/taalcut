// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Scan exact clip pages without retaining descriptions or reconstructing the whole timeline. */
import { resultJson, type RequestView, type ToolCall } from './anthropic-view';
import { collectionSize, notes, selectFields, sourceOf, withNote } from './make-flow-select';
import type { DemoTurn } from './script';

type Json = Record<string, unknown>;
type Found = { json: Json; note?: string; turn?: undefined } | { turn: DemoTurn };
interface Cursor {
  next: number;
  index: number;
  partial: string;
  depth: number;
  quoted: boolean;
  escaped: boolean;
  opened: boolean;
  accurate: boolean;
  start?: number;
  size?: number;
  fallback?: boolean;
  items?: boolean;
  complete?: boolean;
  match?: Json;
}
const PREFIX = '[stand-in clip scan] ';
const MAX_PARTIAL = 1024;
const SOURCE = /^(?:Stored as (?:artifact|result)|\[Taalcut\] Read result) (\S+) /;
const PAGE = /^Bytes (\d+)-(\d+) of (\d+)\.\n<untrusted source="artifact">\n([\s\S]*)\n<\/untrusted>$/;
const fresh = (): Cursor => ({
  next: 0,
  index: 0,
  partial: '',
  depth: 0,
  quoted: false,
  escaped: false,
  opened: false,
  accurate: true,
});
const object = (value: unknown): Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
const fields = (clip: Json): Json =>
  Object.fromEntries(
    ['clipId', 'slotId', 'kind', 'locked', 'userPick']
      .filter((key) => Object.hasOwn(clip, key))
      .map((key) => [key, clip[key]]),
  );
const failure = (reason: string): Found => ({
  turn: { text: `I could not read the selected clip: ${reason}` },
});

function page(result: string, path: string, id: string) {
  const prefix = `JSON Pointer ${JSON.stringify(path)} from ${id}.\n`;
  if (!result.startsWith(prefix)) return undefined;
  const match = PAGE.exec(result.slice(prefix.length));
  return match
    ? { from: Number(match[1]), to: Number(match[2]), total: Number(match[3]), text: match[4]! }
    : undefined;
}

function checkpoint(source: string, target: string | null, cursor: Cursor): string {
  return `${PREFIX}${JSON.stringify({ source, target, cursor })}`;
}

function remembered(view: RequestView, source: string, target: string | null): Cursor {
  const saved = object(
    notes(view, PREFIX).findLast((note) => note.source === source && note.target === target)?.cursor,
  );
  if (
    !Number.isInteger(saved.next) ||
    Number(saved.next) < 0 ||
    !Number.isInteger(saved.index) ||
    Number(saved.index) < 0 ||
    typeof saved.partial !== 'string' ||
    Buffer.byteLength(saved.partial) > MAX_PARTIAL
  )
    return fresh();
  return { ...fresh(), ...saved } as Cursor;
}

function accept(cursor: Cursor, clip: Json, target: string | null): void {
  if (clip.kind !== 'clip' || typeof clip.clipId !== 'string') return;
  if (target !== null && clip.clipId !== target) return;
  cursor.match = fields(clip);
  if (target !== null) cursor.complete = true;
}

/** Balanced JSON objects, including nested arrays and escaped quotes, may span UTF-8-safe pages. */
function scan(cursor: Cursor, text: string, from: number, target: string | null): string | undefined {
  let offset = from;
  for (const char of text) {
    const start = offset;
    offset += Buffer.byteLength(char);
    if (cursor.depth === 0) {
      if (!cursor.opened) {
        if (/\s/u.test(char)) continue;
        if (char !== '[') return 'the selected value is not an array.';
        cursor.opened = true;
        continue;
      }
      if (/[,\s]/u.test(char)) continue;
      if (char === ']') {
        cursor.complete = true;
        return;
      }
      if (char !== '{') return 'the clip array contains a non-object.';
      cursor.start = cursor.accurate ? start : undefined;
      cursor.partial = '';
    }
    cursor.partial += char;
    if (cursor.quoted) {
      if (cursor.escaped) cursor.escaped = false;
      else if (char === '\\') cursor.escaped = true;
      else if (char === '"') cursor.quoted = false;
    } else if (char === '"') cursor.quoted = true;
    else if (char === '{' || char === '[') cursor.depth++;
    else if (char === '}' || char === ']') cursor.depth--;
    if (Buffer.byteLength(cursor.partial) > MAX_PARTIAL) {
      cursor.partial = '';
      cursor.fallback = true;
      return;
    }
    if (cursor.depth === 0) {
      try {
        accept(cursor, object(JSON.parse(cursor.partial)), target);
      } catch {
        return 'a complete clip object is not valid JSON.';
      }
      cursor.index++;
      cursor.partial = '';
      if (cursor.complete) return;
    }
  }
}

/** A large object's exact selected byte length lets us skip its unused description without guessing an offset. */
function largeItem(
  view: RequestView,
  timeline: ToolCall,
  id: string,
  source: string,
  target: string | null,
  cursor: Cursor,
): Found {
  const path = `/clips/${cursor.index}`;
  const read = view.calls.findLast(
    (call) => call.name === 'readArtifact' && call.input.id === id && call.input.path === path,
  );
  const saved = () => checkpoint(source, target, cursor);
  if (!read && cursor.size === undefined)
    return { turn: withNote({ toolCall: { name: 'readArtifact', args: { id, path, offset: 0 } } }, saved()) };
  if (read?.result === `Error core.not_found: JSON Pointer ${JSON.stringify(path)} does not exist.`) {
    cursor.complete = true;
    return { json: cursor.match ?? {}, note: saved() };
  }
  const loaded = read ? page(read.result, path, id) : undefined;
  if (loaded) cursor.size = loaded.total;
  if (cursor.size === undefined) return failure('the selected object page is unavailable.');
  let clip: Json | undefined;
  if (loaded && loaded.from === 0 && loaded.to === loaded.total) {
    try {
      clip = object(JSON.parse(loaded.text));
    } catch {
      return failure('the selected object is not valid JSON.');
    }
  }
  if (!clip) {
    const selected = selectFields(view, timeline, { clipId: `${path}/clipId` });
    if (selected.turn) return { turn: withNote(selected.turn, saved()) };
    if (target === null || selected.json.clipId === target) {
      const detail = selectFields(view, timeline, {
        clipId: `${path}/clipId`,
        slotId: `${path}/slotId`,
        kind: `${path}/kind`,
        locked: `${path}/locked`,
        userPick: `${path}/userPick`,
      });
      if (detail.turn) return { turn: withNote(detail.turn, saved()) };
      clip = detail.json;
    } else clip = selected.json;
  }
  accept(cursor, clip, target);
  if (cursor.complete) return { json: cursor.match ?? {}, note: saved() };
  // The array and item selectors both JSON.stringify the same stored value, so their object lengths agree.
  if (cursor.accurate && cursor.start !== undefined && !cursor.items)
    cursor.next = cursor.start + cursor.size;
  else cursor.items = true;
  cursor.index++;
  cursor.depth = 0;
  cursor.partial = '';
  cursor.quoted = false;
  cursor.escaped = false;
  cursor.fallback = cursor.items;
  cursor.start = undefined;
  cursor.size = undefined;
  const count = collectionSize(view, timeline, 'clips');
  if (count !== undefined && cursor.index >= count) {
    cursor.complete = true;
    return { json: cursor.match ?? {}, note: saved() };
  }
  const nextPath = cursor.items ? `/clips/${cursor.index}` : '/clips';
  return {
    turn: withNote(
      {
        toolCall: {
          name: 'readArtifact',
          args: { id, path: nextPath, offset: cursor.items ? 0 : cursor.next },
        },
      },
      saved(),
    ),
  };
}

function readClip(view: RequestView, timeline: ToolCall, wanted: unknown): Found {
  const target = typeof wanted === 'string' ? wanted : null;
  const source = sourceOf(view, timeline);
  const cursor = remembered(view, source, target);
  const saved = () => checkpoint(source, target, cursor);
  if (cursor.complete) return { json: cursor.match ?? {}, note: saved() };
  const inline = resultJson(timeline.result)?.clips;
  if (Array.isArray(inline)) {
    for (const value of inline) {
      accept(cursor, object(value), target);
      if (cursor.complete) break;
    }
    cursor.complete = true;
    return { json: cursor.match ?? {}, note: saved() };
  }
  const id = SOURCE.exec(timeline.result)?.[1];
  if (!id) return failure('the timeline has no exact readback handle.');
  if (cursor.fallback) return largeItem(view, timeline, id, source, target, cursor);
  for (const read of view.calls) {
    if (read.name !== 'readArtifact' || read.input.id !== id || read.input.path !== '/clips') continue;
    if (read.result.startsWith('Error ')) return failure(read.result);
    const loaded = page(read.result, '/clips', id);
    if (!loaded || loaded.from !== cursor.next) continue;
    // Untrusted-text defusing may change visible byte lengths; never derive a skip offset from altered text.
    cursor.accurate &&=
      !loaded.text.includes('‹') && Buffer.byteLength(loaded.text) === loaded.to - loaded.from;
    const error = scan(cursor, loaded.text, loaded.from, target);
    if (error) return failure(error);
    if (cursor.complete) return { json: cursor.match ?? {}, note: saved() };
    if (cursor.fallback) return largeItem(view, timeline, id, source, target, cursor);
    if (loaded.to <= cursor.next) return failure('the page made no progress.');
    cursor.next = loaded.to;
    if (cursor.next >= loaded.total) return failure('the clip array ended before its closing bracket.');
  }
  return {
    turn: withNote(
      { toolCall: { name: 'readArtifact', args: { id, path: '/clips', offset: cursor.next } } },
      saved(),
    ),
  };
}

export function findClip(view: RequestView, timeline: ToolCall, wanted: unknown): Found {
  const found = readClip(view, timeline, wanted);
  if (found.turn?.toolCall?.name !== 'readArtifact' || view.tools.includes('readArtifact')) return found;
  return {
    turn: { ...found.turn, toolCall: { name: 'findTools', args: { query: 'readArtifact' } } },
  };
}
