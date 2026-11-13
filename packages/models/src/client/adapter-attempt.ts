// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One attempt served by an in-process ModelClient instead of pi-ai (the
 * embedded local runtime's adapter form, D16). Its events are forwarded as
 * they come; its terminal event is not, because the outer chain decides
 * whether the call ends or falls back.
 */
import { effortReasoning } from '@taalcut/core';
import type { ModelChoice } from '../modules';
import type { AttemptOutcome } from './attempt';
import type { Emit } from './model-stream';
import { ON_DEVICE_THINKING } from './thinking';
import type { ModelClient, ModelRequest } from './types';

export async function runAdapterAttempt(
  adapter: ModelClient,
  request: ModelRequest,
  choice: ModelChoice,
  emit: Emit,
): Promise<AttemptOutcome> {
  let producedOutput = false;
  // An in-process runtime is on this device: an effort becomes its one level (thinking off).
  const { effort, ...rest } = request;
  const stream = adapter.stream({
    ...rest,
    target: choice,
    ...(effort ? { reasoning: effortReasoning(effort, ON_DEVICE_THINKING) } : {}),
  });
  for await (const event of stream) {
    if (event.type === 'done' || event.type === 'error' || event.type === 'fallback') continue;
    if (event.type === 'text_delta' || event.type === 'reasoning_delta' || event.type === 'tool_call')
      producedOutput = true;
    emit(event);
  }
  return { result: await stream.result(), producedOutput };
}
