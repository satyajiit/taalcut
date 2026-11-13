// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One request on the wire and how it ended: the answer when it passed (2xx, or a 404 the call allows), else the
 * provider's error mapped with the key scrubbed; a dropped connection is `models.provider_unavailable`, a cancel
 * `core.cancelled`.
 */
import { CancelledError, type TaalcutError } from '@taalcut/core';
import type { HttpMeter } from '../client/http-meter';
import { ModelProviderUnavailable } from '../errors';
import { scrubSecrets } from '../scrub';
import { ELEVENLABS_PROVIDER } from './config';
import { wireError } from './error-map';
import type { WireRequest } from './wire-request';
import type { WireCall, WireOutcome, WireResponse } from './wire-types';

const isAbort = (cause: unknown, signal?: AbortSignal) =>
  signal?.aborted === true || (cause instanceof Error && cause.name === 'AbortError');

function passed(call: WireCall, status: number): boolean {
  return (status >= 200 && status < 300) || (call.notFoundOk === true && status === 404);
}

function failed(
  call: WireCall,
  answer: WireResponse,
  meter: HttpMeter,
  secrets: readonly string[],
): TaalcutError {
  return wireError({
    status: answer.status,
    body: new TextDecoder().decode(answer.bytes),
    model: call.model,
    feature: call.module,
    ...(meter.retryAfterMs !== undefined ? { retryAfterMs: meter.retryAfterMs } : {}),
    secrets,
  });
}

function thrown(call: WireCall, cause: unknown, secrets: readonly string[]): TaalcutError {
  if (isAbort(cause, call.signal)) return CancelledError();
  const message = cause instanceof Error ? cause.message : String(cause);
  return ModelProviderUnavailable(
    { provider: ELEVENLABS_PROVIDER, model: call.model },
    { detail: scrubSecrets(message, secrets) },
  );
}

export async function exchange(
  meter: HttpMeter,
  request: WireRequest,
  call: WireCall,
  secrets: readonly string[],
): Promise<WireOutcome> {
  try {
    const response = await meter.fetch(request.url, request.init);
    const answer = {
      status: response.status,
      headers: response.headers,
      bytes: new Uint8Array(await response.arrayBuffer()),
    };
    return passed(call, answer.status)
      ? { response: answer }
      : { error: failed(call, answer, meter, secrets) };
  } catch (cause) {
    return { error: thrown(call, cause, secrets) };
  }
}
