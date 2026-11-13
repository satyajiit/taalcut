// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The CloudCallRecord of one request (G9): sizes, counts, what it billed and how it ended; never the key, the text or
 * the audio. Tokens are 0: ElevenLabs bills characters, seconds or credits.
 */
import {
  CancelledError,
  newId,
  type CloudCallRecord,
  type GenerationTrace,
  type TaalcutError,
} from '@taalcut/core';
import type { HttpMeter } from '../client/http-meter';
import { ELEVENLABS_PROVIDER } from './config';
import type { WireCall, WireOutcome } from './wire-types';

function traceFields(trace: GenerationTrace | undefined): Partial<CloudCallRecord> {
  return {
    ...(trace?.runId ? { runId: trace.runId } : {}),
    ...(trace?.spanId ? { spanId: trace.spanId } : {}),
    ...(trace?.projectId ? { projectId: trace.projectId } : {}),
  };
}

function endFields(call: WireCall, outcome: WireOutcome): Partial<CloudCallRecord> {
  if ('error' in outcome) {
    const error: TaalcutError = outcome.error;
    return { outcome: CancelledError.is(error) ? 'cancelled' : 'error', errorCode: error.code, costUsd: 0 };
  }
  const billing = call.bill?.(outcome.response);
  return {
    outcome: 'ok',
    costUsd: billing?.costUsd ?? 0,
    ...(billing?.billed ? { billed: billing.billed } : {}),
  };
}

export function wireRecord(
  call: WireCall,
  outcome: WireOutcome,
  meter: HttpMeter,
  timing: { readonly startedAt: number; readonly endedAt: number },
): CloudCallRecord {
  return {
    id: newId<'CloudCall'>(),
    module: call.module,
    provider: ELEVENLABS_PROVIDER,
    model: call.model,
    reasoning: 'off',
    local: false,
    startedAt: timing.startedAt,
    latencyMs: Math.max(0, timing.endedAt - timing.startedAt),
    bytesSent: call.formBytes ?? meter.bytesSent,
    bytesReceived: meter.bytesReceived,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    outcome: 'ok',
    attempt: 1,
    ...(meter.lastStatus !== undefined ? { httpStatus: meter.lastStatus } : {}),
    ...traceFields(call.trace),
    ...endFields(call, outcome),
  };
}
