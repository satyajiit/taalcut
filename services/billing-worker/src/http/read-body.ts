// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { jsonValue } from '../encoding/json-text';

/** Bodies over this are refused before they are parsed. An order is a few hundred bytes; a delivery a few thousand. */
export const MAX_BODY_BYTES = 64 * 1024;

export type TextBody = { ok: true; text: string } | { ok: false; reason: 'too-large' | 'invalid' };
export type JsonBody =
  { ok: true; value: unknown } | { ok: false; reason: 'too-large' | 'invalid' | 'not-json' };

/** The body as the exact text that was sent: a delivery's signature is over these bytes, not over a re-encoding. */
export async function readTextBody(request: Request): Promise<TextBody> {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0 || length > MAX_BODY_BYTES)
      return { ok: false, reason: 'too-large' };
  }
  const bytes = await readCapped(request, MAX_BODY_BYTES);
  if (bytes === 'too-large') return { ok: false, reason: 'too-large' };
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    // Not UTF-8: the body is refused as invalid.
    return { ok: false, reason: 'invalid' };
  }
}

/**
 * The body as JSON. The request must say it is JSON: a browser has to ask this Worker's permission (a preflight)
 * before a page on another site may send that, which a plain form post or a `text/plain` request never needs.
 */
export async function readJsonBody(request: Request): Promise<JsonBody> {
  const type = (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') return { ok: false, reason: 'not-json' };
  const body = await readTextBody(request);
  if (!body.ok) return body;
  const value = jsonValue(body.text);
  return value === undefined ? { ok: false, reason: 'invalid' } : { ok: true, value };
}

async function readCapped(request: Request, max: number): Promise<Uint8Array | 'too-large'> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > max) {
      await reader.cancel();
      return 'too-large';
    }
    chunks.push(step.value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
