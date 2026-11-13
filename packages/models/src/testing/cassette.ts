// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Record and replay of model traffic at the HTTP layer (P1-I3).
 *
 * A cassette is a `fetch` you pass to createModelClient. In record mode it
 * forwards requests and saves each exchange, scrubbed of secrets, to a JSON
 * fixture. In replay mode it answers from the fixture and never touches the
 * network. Recording at the HTTP layer (not pi-ai's event layer) means replay
 * still runs pi-ai's real request building, SSE parsing, usage and cost code,
 * so a pi-ai upgrade that changes behaviour shows up as a failing replay.
 *
 * TAALCUT_RECORD=1 switches every cassette to record mode.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { FetchFn } from '../client/http-meter';
import { scrubSecrets, scrubUrl } from '../scrub';

export type CassetteMode = 'replay' | 'record';

export interface CassetteOptions {
  /** Absolute path of the fixture file. */
  readonly path: string;
  /** Default: 'record' when TAALCUT_RECORD=1, otherwise 'replay'. */
  readonly mode?: CassetteMode;
  /** Exact values to scrub when recording (the keys used for the recording). */
  readonly secrets?: readonly string[];
  /** Where record mode sends requests. Default: globalThis.fetch. */
  readonly upstream?: FetchFn;
  /** Top-level body fields that vary between runs and must not affect matching. */
  readonly ignoreBodyFields?: readonly string[];
  /** Saved in the fixture, e.g. where the traffic came from. */
  readonly note?: string;
}

export interface Cassette {
  readonly mode: CassetteMode;
  readonly path: string;
  readonly fetch: FetchFn;
  /** Recorded exchanges not replayed yet. */
  unused(): number;
  /** Requests replay had no recording for (each got an HTTP 400 explaining why). */
  misses(): readonly string[];
  /** Record mode: waits for in-flight exchanges and writes the fixture. */
  save(): Promise<void>;
}

interface Interaction {
  request: { method: string; url: string; match: string; headers: Record<string, string>; body: unknown };
  response: { status: number; headers: Record<string, string>; chunks: string[] };
}

interface CassetteFile {
  format: 'taalcut-model-cassette';
  version: 1;
  recordedAt: string;
  note: string;
  interactions: Interaction[];
}

const DEFAULT_IGNORED_FIELDS = ['prompt_cache_key', 'metadata', 'user', 'session_id'];
const KEPT_REQUEST_HEADERS = ['content-type', 'accept', 'anthropic-version', 'anthropic-beta', 'openai-beta'];
const KEPT_RESPONSE_HEADERS = ['content-type', 'retry-after', 'retry-after-ms', 'x-should-retry'];

export function cassetteModeFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): CassetteMode {
  return env.TAALCUT_RECORD === '1' ? 'record' : 'replay';
}

export function openCassette(options: CassetteOptions): Cassette {
  const mode = options.mode ?? cassetteModeFromEnv();
  const secrets = options.secrets ?? [];
  const ignored = new Set(options.ignoreBodyFields ?? DEFAULT_IGNORED_FIELDS);
  const name = basename(options.path);

  const describe = (input: Parameters<FetchFn>[0], init: Parameters<FetchFn>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const text = typeof init?.body === 'string' ? init.body : '';
    const body = parseJson(scrubSecrets(text, secrets));
    const path = new URL(url).pathname;
    const match = `${method} ${path} ${hash(canonical(body, ignored))}`;
    return { url, method, body, match };
  };

  if (mode === 'replay') {
    if (!existsSync(options.path)) {
      throw new Error(`No cassette at ${options.path}. Record it with TAALCUT_RECORD=1.`);
    }
    const file = JSON.parse(readFileSync(options.path, 'utf8')) as CassetteFile;
    const used = new Set<number>();
    const misses: string[] = [];
    const replay: FetchFn = async (input, init) => {
      const { match } = describe(input, init);
      init?.signal?.throwIfAborted();
      const index = file.interactions.findIndex((x, i) => !used.has(i) && x.request.match === match);
      if (index < 0) {
        misses.push(match);
        return missResponse(
          `Cassette ${name}: no recorded response for ${match}. The request changed since recording; re-record with TAALCUT_RECORD=1.`,
        );
      }
      used.add(index);
      return replayResponse(file.interactions[index]!.response, init?.signal ?? undefined);
    };
    return {
      mode,
      path: options.path,
      fetch: replay,
      unused: () => file.interactions.length - used.size,
      misses: () => misses,
      save: async () => undefined,
    };
  }

  const upstream: FetchFn = options.upstream ?? ((input, init) => globalThis.fetch(input, init));
  const interactions: (Interaction | undefined)[] = [];
  const inFlight = new Set<Promise<void>>();
  const write = () => {
    const file: CassetteFile = {
      format: 'taalcut-model-cassette',
      version: 1,
      recordedAt: new Date().toISOString(),
      note:
        options.note ?? 'Recorded by @taalcut/models. Secrets are scrubbed. Re-record with TAALCUT_RECORD=1.',
      interactions: interactions.filter((x): x is Interaction => x !== undefined),
    };
    mkdirSync(dirname(options.path), { recursive: true });
    writeFileSync(options.path, `${JSON.stringify(file, null, 2)}\n`);
  };

  const record: FetchFn = async (input, init) => {
    const { url, method, body, match } = describe(input, init);
    const slot = interactions.length;
    interactions.push(undefined);
    const response = await upstream(input, init);
    const request = {
      method,
      url: scrubUrl(url),
      match,
      headers: pickHeaders(init?.headers, KEPT_REQUEST_HEADERS),
      body,
    };
    if (!response.body) {
      interactions[slot] = {
        request,
        response: {
          status: response.status,
          headers: pickHeaders(response.headers, KEPT_RESPONSE_HEADERS),
          chunks: [],
        },
      };
      write();
      return response;
    }
    const [forCaller, forTape] = response.body.tee();
    const done: Promise<void> = (async () => {
      try {
        const text = await new Response(forTape).text();
        interactions[slot] = {
          request,
          response: {
            status: response.status,
            headers: pickHeaders(response.headers, KEPT_RESPONSE_HEADERS),
            chunks: splitEvents(scrubSecrets(text, secrets)),
          },
        };
        write();
      } catch {
        // An aborted stream can't be replayed faithfully, so it isn't recorded.
      }
    })();
    inFlight.add(done);
    void done.then(() => inFlight.delete(done));
    return new Response(forCaller, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };

  return {
    mode,
    path: options.path,
    fetch: record,
    unused: () => 0,
    misses: () => [],
    save: async () => {
      await Promise.all(inFlight);
      write();
    },
  };
}

/**
 * A replay miss answers HTTP 400 with the reason in the body. Throwing would be
 * swallowed: provider SDKs turn fetch exceptions into a bare "Connection error".
 */
function missResponse(message: string): Response {
  const body = { type: 'error', error: { type: 'cassette_miss', code: 'cassette_miss', message } };
  return new Response(JSON.stringify(body), { status: 400, headers: { 'content-type': 'application/json' } });
}

function replayResponse(recorded: Interaction['response'], signal: AbortSignal | undefined): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener(
        'abort',
        () => controller.error(signal.reason ?? new DOMException('Aborted', 'AbortError')),
        { once: true },
      );
    },
    pull(controller) {
      const chunk = recorded.chunks[index++];
      if (chunk === undefined) controller.close();
      else controller.enqueue(encoder.encode(chunk));
    },
  });
  return new Response(recorded.chunks.length > 0 ? body : null, {
    status: recorded.status,
    headers: recorded.headers,
  });
}

/** Keeps SSE events as separate chunks so replay streams like the original. */
function splitEvents(text: string): string[] {
  if (!text.includes('\n\n')) return text ? [text] : [];
  return text.split(/(?<=\n\n)/).filter((part) => part.length > 0);
}

function pickHeaders(
  headers: ConstructorParameters<typeof Headers>[0],
  keep: readonly string[],
): Record<string, string> {
  const all = new Headers(headers ?? {});
  const out: Record<string, string> = {};
  for (const name of keep) {
    const value = all.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Sorted-key JSON without the volatile fields, so matching ignores key order and run-specific values. */
function canonical(body: unknown, ignored: ReadonlySet<string>): string {
  const sort = (value: unknown, top: boolean): unknown => {
    if (Array.isArray(value)) return value.map((v) => sort(v, false));
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !(top && ignored.has(key)))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return Object.fromEntries(entries.map(([k, v]) => [k, sort(v, false)]));
    }
    return value;
  };
  return JSON.stringify(sort(body, true));
}

function hash(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex').slice(0, 16)}`;
}
