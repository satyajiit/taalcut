// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The one fetch path to ElevenLabs (SPEC P3.2): Local only refused before anything is sent (no row), the key from the
 * CredentialProvider as `xi-api-key` (wire-request.ts), the http meter for bytes, exactly one CloudCallRecord per
 * request that went out (wire-record.ts), and failures mapped to TaalcutErrors with the key scrubbed
 * (wire-exchange.ts). It also remembers whether the last lookup found a key, so `available()` can answer
 * synchronously.
 */
import {
  CancelledError,
  err,
  LocalOnly,
  ok,
  type AsyncResult,
  type CloudCallSink,
  type Result,
} from '@taalcut/core';
import { recordCloudCall } from '../calls/cloud-call';
import { createHttpMeter, type FetchFn } from '../client/http-meter';
import type { CredentialProvider } from '../credentials/credential-provider';
import { ModelAuthInvalid, ModelNotConfigured } from '../errors';
import { ELEVENLABS_BASE_URL, ELEVENLABS_PROVIDER } from './config';
import { exchange } from './wire-exchange';
import { wireRecord } from './wire-record';
import { wireRequest } from './wire-request';
import type { WireCall, WireResponse } from './wire-types';

export interface ElevenLabsHttpDeps {
  readonly credentials: CredentialProvider;
  readonly callLog: CloudCallSink;
  /** Settings → Privacy → Local only, read on every request. */
  readonly localOnly: () => boolean;
  /** Base fetch; record/replay fakes plug in here. Default: globalThis.fetch, read per call. */
  readonly fetch?: FetchFn;
  readonly now?: () => number;
  readonly baseUrl?: string;
}

export type KeyState = 'unknown' | 'present' | 'missing';

export interface ElevenLabsHttp {
  send(call: WireCall): AsyncResult<WireResponse>;
  /** What the last credential lookup found. */
  keyState(): KeyState;
  /** Looks the key up now (start-up, after a key change), so `available()` is current. */
  checkKey(signal?: AbortSignal): AsyncResult<KeyState>;
  readonly localOnly: () => boolean;
}

export function createElevenLabsHttp(deps: ElevenLabsHttpDeps): ElevenLabsHttp {
  const now = deps.now ?? Date.now;
  const baseFetch: FetchFn = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const baseUrl = deps.baseUrl ?? ELEVENLABS_BASE_URL;
  let keyState: KeyState = 'unknown';

  async function secret(signal?: AbortSignal): AsyncResult<string | undefined> {
    const credential = await deps.credentials.get(ELEVENLABS_PROVIDER, signal ? { signal } : {});
    if (!credential.ok) return credential;
    const value = credential.value?.secret;
    keyState = value ? 'present' : 'missing';
    return ok(value);
  }

  /** The key for a request that may go out: refused under Local only, when cancelled, or with no key. */
  async function preflight(call: WireCall): AsyncResult<string> {
    if (deps.localOnly()) return err(LocalOnly({ what: 'model' }));
    if (call.signal?.aborted) return err(CancelledError());
    const key = await secret(call.signal);
    if (!key.ok) return key;
    return key.value
      ? ok(key.value)
      : err(ModelNotConfigured({ provider: ELEVENLABS_PROVIDER, model: call.model }));
  }

  async function send(call: WireCall): AsyncResult<WireResponse> {
    const key = await preflight(call);
    if (!key.ok) return key;
    const meter = createHttpMeter(baseFetch);
    const startedAt = now();
    const outcome = await exchange(meter, wireRequest(baseUrl, call, key.value), call, [key.value]);
    // A rejected key: the next lookup asks main again instead of reusing the cached copy.
    if ('error' in outcome && ModelAuthInvalid.is(outcome.error))
      deps.credentials.invalidate?.(ELEVENLABS_PROVIDER);
    await recordCloudCall(deps.callLog, wireRecord(call, outcome, meter, { startedAt, endedAt: now() }));
    const result: Result<WireResponse> = 'response' in outcome ? ok(outcome.response) : err(outcome.error);
    return result;
  }

  return {
    send,
    keyState: () => keyState,
    async checkKey(signal) {
      const key = await secret(signal);
      return key.ok ? ok(keyState) : key;
    },
    localOnly: deps.localOnly,
  };
}
