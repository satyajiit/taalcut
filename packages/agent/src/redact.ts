// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Redaction for the debug bundle (P2-X5, G16; SPEC section 15). Always:
 * every path-shaped string becomes `<path:.ext>`, known secret shapes are
 * scrubbed, model `native` blobs and artifact contents go, and anything that
 * looks like media (a `data:` URL, a long base64 run) is dropped. By default
 * free text goes too (what the user typed, what the model wrote, string
 * fields of tool inputs and outputs): it becomes its length and a short hash.
 * Ids, error codes, enum-like tokens, numbers and timings stay; they are what
 * make a bundle useful. With `includeChatText` the text stays, and paths and
 * secrets still don't.
 */
import { createHash } from 'node:crypto';
import { isId } from '@taalcut/core';
import { scrubSecrets } from '@taalcut/tools';
import type { AgentEvent } from './events';

export interface RedactOptions {
  /** The user chose to include what they typed and what Taalcut replied. */
  readonly includeChatText: boolean;
  /** The home folder: anything under it is a path. */
  readonly home: string;
}

export interface RedactionCounts {
  text: number;
  paths: number;
  secrets: number;
}

/** keep: scrub paths and secrets only. text: free text goes, ids and tokens stay. chat: every string goes. */
export type RedactMode = 'keep' | 'text' | 'chat';

export interface RedactedText {
  readonly redacted: 'text' | 'binary';
  readonly chars: number;
  readonly sha256?: string;
}

const MEDIA_EXTENSIONS =
  'mov|mp4|m4v|mkv|webm|avi|mts|m2ts|3gp|hevc|heic|heif|jpe?g|png|gif|webp|tiff?|bmp|dng|raw|wav|mp3|m4a|aac|flac|ogg|opus|aiff?|srt|vtt|json|txt|csv|pdf|md|otio|zip';
const FILE_URL = /file:\/\/[^\s"'<>]+/gi;
const TILDE = /(?<![\w~])~\/[^\s"'<>]*/g;
/** `/Users/x`, `/Volumes/Card/DCIM`: a slash, then at least one segment followed by another slash. */
const ABSOLUTE = /(?<![\w:/.~-])\/(?:[^\s/"'<>]+\/)+[^\s"'<>]*/g;
const BARE_FILE = new RegExp(`(?<![\\w./-])[\\w-]+(?:\\.[\\w-]+)*\\.(?:${MEDIA_EXTENSIONS})\\b`, 'gi');
const BINARY = /data:[^\s"',;]*;base64,|[A-Za-z0-9+/]{1024,}/i;
const TOKEN = /^[a-z][a-zA-Z0-9]*(?:[._:-][a-zA-Z0-9]+)*$/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const PLACEHOLDER = /^<path:[^>]*>$/;
const TRAILING = /[.,;:)\]}]+$/;

function placeholder(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(base)?.[1];
  return `<path:${ext ? `.${ext.toLowerCase()}` : ''}>`;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface Redactor {
  readonly counts: RedactionCounts;
  string(value: string, mode: RedactMode): string | RedactedText;
  value(value: unknown, mode: RedactMode): unknown;
}

/** A redactor that counts what it replaced, for a section's preview. */
export function createRedactor(options: RedactOptions): Redactor {
  const counts: RedactionCounts = { text: 0, paths: 0, secrets: 0 };
  const home = options.home.replace(/\/+$/, '');
  const underHome = home.length > 1 ? new RegExp(`${escapeRegExp(home)}(?:/[^\\s"'<>]*)?`, 'g') : undefined;

  const replacePaths = (text: string): string => {
    let out = text;
    for (const pattern of [underHome, FILE_URL, TILDE, ABSOLUTE, BARE_FILE]) {
      if (!pattern) continue;
      out = out.replace(pattern, (match) => {
        const tail = TRAILING.exec(match)?.[0] ?? '';
        counts.paths += 1;
        return `${placeholder(match.slice(0, match.length - tail.length))}${tail}`;
      });
    }
    return out;
  };

  const hidden = (text: string): RedactedText => {
    counts.text += 1;
    return {
      redacted: 'text',
      chars: text.length,
      sha256: createHash('sha256').update(text).digest('hex').slice(0, 8),
    };
  };

  const keepable = (text: string) =>
    isId(text) || PLACEHOLDER.test(text) || NUMBER.test(text) || (text.length <= 64 && TOKEN.test(text));

  const string = (value: string, mode: RedactMode): string | RedactedText => {
    if (value.length === 0) return value;
    if (BINARY.test(value)) {
      counts.text += 1;
      return { redacted: 'binary', chars: value.length };
    }
    const pathless = replacePaths(value);
    const scrubbed = scrubSecrets(pathless);
    if (scrubbed !== pathless) counts.secrets += 1;
    if (mode === 'keep' || options.includeChatText) return scrubbed;
    if (mode === 'text' && keepable(scrubbed)) return scrubbed;
    return hidden(scrubbed);
  };

  const value = (input: unknown, mode: RedactMode): unknown => {
    if (typeof input === 'string') return string(input, mode);
    if (Array.isArray(input)) return input.map((item) => value(item, mode));
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input)
          // Provider-native message blobs (encrypted reasoning, signatures) never leave.
          .filter(([key]) => key !== 'native')
          .map(([key, item]) => [key, value(item, mode)]),
      );
    }
    return input;
  };

  return { counts, string, value };
}

/** Event types whose payload is all ids, codes, numbers and short reasons: paths and secrets scrubbed only. */
const KEEP_TYPES: ReadonlySet<string> = new Set([
  'model.requested',
  'model.failed',
  'tool.failed',
  'approval.requested',
  'budget.raised',
  'checkpoint.saved',
  'run.paused',
  'run.resumed',
  'run.failed',
  'run.cancelled',
  // Phase 2: ids, numbers and enums only.
  'estimate.recorded',
  'estimate.settled',
  'flow.inputChanged',
  'flow.abandoned',
  'step.skipped',
]);

/** Fields that are someone's words (the user's or the model's), per event type. */
const CHAT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  'run.started': ['message'],
  'step.started': ['text'],
  'route.chosen': ['query'],
  'model.responded': ['text'],
  'approval.granted': ['note'],
  'approval.denied': ['note'],
  'run.completed': ['report'],
  'verify.result': ['reason'],
};

/** Fields that are tool inputs or outputs (free text goes, ids and tokens stay). */
const TEXT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  'model.responded': ['toolCalls'],
  'tool.requested': ['input'],
  // A skill's handoff (a brief's text, say), repeated on its handOff call; the call's summary names a file.
  'tool.completed': ['handoff', 'summary'],
};

/** Types with nested words and ids, handled field by field below. */
const STRUCTURED_TYPES: ReadonlySet<string> = new Set(['plan.created', 'plan.updated', 'tool.completed']);

type Fields = Record<string, unknown>;

function redactPayload(type: string, payload: Fields, r: Redactor): Fields {
  const chat = CHAT_FIELDS[type] ?? [];
  const text = TEXT_FIELDS[type] ?? [];
  const out: Fields = {};
  for (const [key, item] of Object.entries(payload)) {
    if (key === 'native') continue;
    const mode: RedactMode = chat.includes(key) ? 'chat' : text.includes(key) ? 'text' : 'keep';
    out[key] = special(type, key, item, r) ?? r.value(item, mode);
  }
  return out;
}

/** run.started's nested shapes: the history's turns, and (LRN1-MEM) the memory the run recalled. */
function startedField(key: string, item: unknown, r: Redactor): unknown {
  if (!item || typeof item !== 'object') return undefined;
  const record = item as Fields;
  if (key === 'history') {
    const turns = Array.isArray(record.turns) ? (record.turns as Fields[]) : [];
    return {
      ...(record.trimmed !== undefined ? { trimmed: r.value(record.trimmed, 'keep') } : {}),
      turns: turns.map(({ user, tools, answer, ...rest }) => ({
        ...(r.value(rest, 'keep') as Fields),
        user: r.value(user, 'chat'),
        tools: r.value(tools, 'chat'),
        answer: r.value(answer, 'chat'),
      })),
    };
  }
  if (key === 'memory') {
    // The recalled items' words are the creator's (or a model's): only their shape stays.
    const items = Array.isArray(record.items) ? (record.items as Fields[]) : [];
    const { items: _items, product, ...rest } = record;
    return {
      ...(r.value(rest, 'keep') as Fields),
      ...(product ? { product: r.value(product, 'chat') } : {}),
      items: items.map(({ text, scopeName, ...fields }) => ({
        ...(r.value(fields, 'keep') as Fields),
        text: r.value(text, 'chat'),
        scopeName: r.value(scopeName, 'chat'),
      })),
    };
  }
  return undefined;
}

/** Nested shapes that mix words and ids: messages, plan steps, history turns, tool outputs. */
function special(type: string, key: string, item: unknown, r: Redactor): unknown {
  const record = (item ?? {}) as Fields;
  if (type === 'model.responded' && key === 'message') {
    const { parts, ...rest } = record;
    return {
      ...(r.value(rest, 'keep') as Fields),
      parts: (Array.isArray(parts) ? (parts as Fields[]) : []).map((part) =>
        part.type === 'tool_call'
          ? { type: 'tool_call', call: r.value(part.call, 'text') }
          : { type: part.type, text: r.value(part.text, 'chat') },
      ),
    };
  }
  if ((type === 'plan.created' || type === 'plan.updated') && key === 'steps' && Array.isArray(item)) {
    return (item as Fields[]).map(({ text, input, ...rest }) => ({
      ...(r.value(rest, 'keep') as Fields),
      text: r.value(text, 'chat'),
      ...(input !== undefined ? { input: r.value(input, 'text') } : {}),
    }));
  }
  if (type === 'run.started') return startedField(key, item, r);
  if (type === 'tool.completed' && key === 'output') {
    // Artifacts may be contact sheets or frames: only their id, type and size stay.
    if (record.kind === 'artifact') {
      const ref = (record.ref ?? {}) as Fields;
      return { kind: 'artifact', ref: { id: ref.id, mediaType: ref.mediaType, bytes: ref.bytes } };
    }
    return { kind: record.kind, value: r.value(record.value, 'text') };
  }
  return undefined;
}

/**
 * One logged event, redacted for a debug bundle. Unknown event types are
 * treated as tool data: free text goes, ids and tokens stay.
 */
export function redactRunEvent(
  event: AgentEvent,
  options: RedactOptions,
  redactor: Redactor = createRedactor(options),
): { event: Record<string, unknown>; counts: RedactionCounts } {
  const payload = (event.payload ?? {}) as Fields;
  const known =
    KEEP_TYPES.has(event.type) ||
    event.type in CHAT_FIELDS ||
    event.type in TEXT_FIELDS ||
    STRUCTURED_TYPES.has(event.type);
  const redacted = known
    ? redactPayload(event.type, payload, redactor)
    : (redactor.value(payload, 'text') as Fields);
  return {
    event: {
      runId: event.runId,
      seq: event.seq,
      type: event.type,
      v: event.v,
      at: event.at,
      payload: redacted,
    },
    counts: redactor.counts,
  };
}
