// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The image providers' wire for tests (P3-B7), with no network: answers from the fixtures in
 * `test/fixtures/images/`, which hold each provider's documented response shape (research
 * image-generation.md, 2026-10-14; no live call has been recorded yet, models SPEC P3.10). `{{png:WxH}}` and
 * `{{jpeg:WxH}}` in a fixture stand for a base64 image of that size, made here. Every request is kept, so a
 * test can say exactly what was sent where.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import {
  createStaticCredentialProvider,
  type FetchFn,
  type ModelChoice,
  type ModelSelector,
  type ResolvedCredential,
} from '@taalcut/models';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'images');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** A real (grey, 8-bit) PNG of this size. */
export function png(width: number, height: number): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 0, 0, 0, 0], 8);
  const raw = Buffer.alloc(height * (width + 1));
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', new Uint8Array()),
    ]),
  );
}

/** A JPEG's header up to its frame (SOF0) of this size: what the size reader looks at. */
export function jpeg(width: number, height: number): Uint8Array {
  const app0 = [
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0, 0,
  ];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03];
  const components = [0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, ...components, 0xff, 0xd9]);
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

/** A fixture's body with its image placeholders filled; `count` repeats the first image entry. */
export function fixtureBody(name: string, count = 1): string {
  const text = readFileSync(join(FIXTURES, `${name}.json`), 'utf8').replace(
    /\{\{(png|jpeg):(\d+)x(\d+)\}\}/g,
    (_, kind: string, w: string, h: string) =>
      b64(kind === 'png' ? png(Number(w), Number(h)) : jpeg(Number(w), Number(h))),
  );
  if (count === 1) return text;
  const json: { data?: unknown[] } = JSON.parse(text);
  if (!json.data?.[0]) return text;
  json.data = Array.from({ length: count }, () => json.data?.[0]);
  return JSON.stringify(json);
}

export interface SentImageRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Record<string, unknown>;
}

export type Answer = (sent: SentImageRequest) => Response | Promise<Response>;

export const json = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'content-type': 'application/json', ...headers } });

/** A fetch that answers by URL prefix and keeps every request. An unknown URL is a test bug: it throws. */
export function wire(answers: Readonly<Record<string, Answer>>) {
  const sent: SentImageRequest[] = [];
  const fetch: FetchFn = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body: Record<string, unknown> = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    const request = { url, headers, body };
    sent.push(request);
    const answer = Object.entries(answers).find(([prefix]) => url.startsWith(prefix))?.[1];
    if (!answer) throw new Error(`No answer for ${url}`);
    return answer(request);
  };
  return { fetch, sent };
}

export const URLS = {
  openrouter: 'https://openrouter.ai/api/v1/images',
  xai: 'https://api.x.ai/v1/images/generations',
  google: 'https://generativelanguage.googleapis.com/v1beta/interactions',
  openai: 'https://api.openai.com/v1/images/generations',
} as const;

/** API keys for these providers; the key is `image-test-key-<provider>`. */
export function keys(...providers: string[]) {
  const credentials: Record<string, ResolvedCredential> = {};
  for (const provider of providers)
    credentials[provider] = { kind: 'api_key', secret: `image-test-key-${provider}`, source: 'test' };
  return createStaticCredentialProvider(credentials);
}

/** OAuth credentials; the image route determines whether its endpoint accepts them. */
export function signIns(...providers: string[]) {
  const credentials: Record<string, ResolvedCredential> = {};
  for (const provider of providers)
    credentials[provider] = { kind: 'oauth_access', secret: `oauth-${provider}`, source: 'OAuth' };
  return createStaticCredentialProvider(credentials);
}

export const selectorOf = (...choices: Pick<ModelChoice, 'provider' | 'model'>[]): ModelSelector => ({
  resolve: (module) => ({ ok: true, value: { module, choices } }),
});

/** The images chains the tests use, in OpenRouter's names as the profiles write them. */
export const GROK = { provider: 'openrouter', model: 'x-ai/grok-imagine-image-2.0' };
export const NANO_BANANA = { provider: 'openrouter', model: 'google/gemini-nano-banana-2.1' };
export const FLARE = { provider: 'openrouter', model: 'openai/gpt-image-2.5-flare' };
