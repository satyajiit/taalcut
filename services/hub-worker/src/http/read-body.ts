// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { concatBytes } from '../encoding/bytes';
import { jsonValue } from '../encoding/json-text';

/** Bodies over this are refused before JSON.parse. */
export const MAX_BODY_BYTES = 256 * 1024;

export type JsonBody = { ok: true; value: unknown } | { ok: false; reason: 'too-large' | 'invalid' };

export async function readJsonBody(request: Request): Promise<JsonBody> {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0 || length > MAX_BODY_BYTES)
      return { ok: false, reason: 'too-large' };
  }
  const bytes = await readCapped(request, MAX_BODY_BYTES);
  if (bytes === 'too-large') return { ok: false, reason: 'too-large' };
  const text = utf8(bytes);
  const value = text === undefined ? undefined : jsonValue(text);
  return value === undefined ? { ok: false, reason: 'invalid' } : { ok: true, value };
}

function utf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Not UTF-8: the body is refused as invalid.
    return undefined;
  }
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
  return concatBytes(chunks);
}
