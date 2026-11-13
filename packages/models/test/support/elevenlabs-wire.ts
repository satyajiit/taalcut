// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * ElevenLabs over a local fake fetch: each route answers from the recorded fixtures in test/fixtures/elevenlabs
 * (written from the documented wire shapes, scrubbed), and every request is kept for the assertions. Nothing
 * reaches the network: the suites also turn it off.
 */
import { readFileSync } from 'node:fs';
import {
  createElevenLabsSession,
  createMemoryCloudCallSink,
  createStaticCredentialProvider,
  type CredentialProvider,
  type ElevenLabsSession,
  type FetchFn,
  type MemoryCloudCallSink,
} from '@taalcut/models';

export const ELEVEN_KEY = 'sk_3f2a9c0d1e4b5a6978c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4';

export function fixture(name: string): unknown {
  const url = new URL(`../fixtures/elevenlabs/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as unknown;
}

export function errorBody(status: string): unknown {
  return (fixture('errors') as Record<string, unknown>)[status];
}

export interface WireReply {
  /** The request is cancelled while it is on the wire. */
  readonly abort?: boolean;
  readonly status?: number;
  readonly json?: unknown;
  readonly bytes?: Uint8Array;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface SeenRequest {
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly json?: Record<string, unknown>;
  readonly form?: FormData;
}

export interface ElevenLabsWire {
  readonly fetch: FetchFn;
  readonly requests: SeenRequest[];
  /** Queues replies for `'<METHOD> <path>'`, in order. */
  script(route: string, ...replies: WireReply[]): void;
  /** Replies queued and not asked for. */
  pending(): number;
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, name) => {
    out[name] = value;
  });
  return out;
}

export function createElevenLabsWire(): ElevenLabsWire {
  const routes = new Map<string, WireReply[]>();
  const requests: SeenRequest[] = [];
  const fetch: FetchFn = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? 'GET';
    const body = init?.body;
    requests.push({
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: headersOf(init),
      ...(typeof body === 'string' ? { json: JSON.parse(body) as Record<string, unknown> } : {}),
      ...(body instanceof FormData ? { form: body } : {}),
    });
    const reply = routes.get(`${method} ${url.pathname}`)?.shift();
    if (!reply) throw new Error(`No scripted reply for ${method} ${url.pathname}`);
    if (reply.abort) throw new DOMException('This operation was aborted', 'AbortError');
    const status = reply.status ?? 200;
    const payload = reply.bytes ?? (reply.json !== undefined ? JSON.stringify(reply.json) : null);
    return new Response(payload, {
      status,
      headers: {
        ...(reply.json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...reply.headers,
      },
    });
  };
  return {
    fetch,
    requests,
    script(route, ...replies) {
      routes.set(route, [...(routes.get(route) ?? []), ...replies]);
    },
    pending: () => [...routes.values()].reduce((n, queue) => n + queue.length, 0),
  };
}

export interface ElevenLabsHarness {
  readonly wire: ElevenLabsWire;
  readonly calls: MemoryCloudCallSink;
  readonly session: ElevenLabsSession;
  readonly settings: { localOnly: boolean };
}

export function elevenLabsHarness(
  options: { readonly key?: string | null; readonly credentials?: CredentialProvider } = {},
): ElevenLabsHarness {
  const wire = createElevenLabsWire();
  const calls = createMemoryCloudCallSink();
  const settings = { localOnly: false };
  const key = options.key === undefined ? ELEVEN_KEY : options.key;
  const credentials =
    options.credentials ??
    createStaticCredentialProvider(
      key === null ? {} : { elevenlabs: { kind: 'api_key', secret: key, source: 'test' } },
    );
  let clock = 1_760_000_000_000;
  const session = createElevenLabsSession({
    credentials,
    callLog: calls,
    localOnly: () => settings.localOnly,
    fetch: wire.fetch,
    now: () => (clock += 25),
  });
  return { wire, calls, session, settings };
}

/** A `multipart/mixed` body, as `POST /v1/music/detailed` answers. */
export function multipartBody(
  boundary: string,
  parts: readonly { readonly headers: Readonly<Record<string, string>>; readonly body: Uint8Array }[],
): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const part of parts) {
    const head = Object.entries(part.headers)
      .map(([name, value]) => `${name}: ${value}\r\n`)
      .join('');
    chunks.push(encoder.encode(`--${boundary}\r\n${head}\r\n`), part.body, encoder.encode('\r\n'));
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`));
  return new Uint8Array(Buffer.concat(chunks));
}

/** A stand-in MP3 (ID3 header and one frame header): bytes only, compared byte for byte. */
export const FAKE_MP3 = new Uint8Array([
  0x49,
  0x44,
  0x33,
  0x04,
  0,
  0,
  0,
  0,
  0,
  0,
  0xff,
  0xfb,
  0x90,
  0x64,
  ...new Array<number>(64).fill(7),
]);
