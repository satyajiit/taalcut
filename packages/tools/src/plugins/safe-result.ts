// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { CancelledError, TimeoutError, err, type AsyncResult, type Result } from '@taalcut/core';
import { PluginConnectionFailed } from './errors';

/** A provider cannot keep access alive by ignoring cancellation or returning an echoed credential. */
export async function pluginAttempt<T>(
  pluginId: string,
  signal: AbortSignal,
  operation: () => AsyncResult<T>,
): AsyncResult<T> {
  const aborted = () =>
    err(
      signal.reason instanceof Error && signal.reason.name === 'TimeoutError'
        ? TimeoutError()
        : CancelledError(),
    );
  if (signal.aborted) return aborted();
  let cancel: (() => void) | undefined;
  const cancelled = new Promise<Result<T>>((resolve) => {
    cancel = () => resolve(aborted());
    signal.addEventListener('abort', cancel, { once: true });
  });
  try {
    return await Promise.race([operation(), cancelled]);
  } catch {
    return err(PluginConnectionFailed({ pluginId }));
  } finally {
    if (cancel) signal.removeEventListener('abort', cancel);
  }
}

export function redactPluginValue<T>(value: T, secrets: readonly string[]): T {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) return value;
  let safe = encoded;
  for (const secret of secrets) {
    if (!secret) continue;
    const escaped = JSON.stringify(secret).slice(1, -1);
    safe = safe.split(escaped).join('[REDACTED]');
    safe = safe.split(encodeURIComponent(secret)).join('[REDACTED]');
  }
  return JSON.parse(safe) as T;
}

export async function closePlugin(close: () => Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      close().catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 2_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
