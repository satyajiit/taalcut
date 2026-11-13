// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Whether the ElevenLabs account can be called at all now: Local only off, and a key unless a lookup found none. */
import type { GenerationAvailability, GenerationTrace } from '@taalcut/core';
import type { ElevenLabsHttp } from './http';

export const AVAILABLE: GenerationAvailability = { ok: true };

export function accountAvailability(
  http: Pick<ElevenLabsHttp, 'localOnly' | 'keyState'>,
): GenerationAvailability {
  if (http.localOnly()) return { ok: false, reason: 'local_only' };
  if (http.keyState() === 'missing') return { ok: false, reason: 'not_configured' };
  return AVAILABLE;
}

/** A provider's call options: the cancel signal and the run it works for, when given. */
export function runOptions(request: { readonly signal?: AbortSignal; readonly trace?: GenerationTrace }) {
  return {
    ...(request.signal ? { signal: request.signal } : {}),
    ...(request.trace ? { trace: request.trace } : {}),
  };
}
