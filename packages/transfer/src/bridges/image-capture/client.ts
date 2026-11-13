// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The bridge's port onto the mac helper's `devices` service (protocol v2),
 * over media's JSON-line sidecar. The sidecar owns the process: it spawns on
 * the first request, restarts after a crash on the next one, and delivers
 * `event` lines. This adapter checks the ready line, bounds each request in
 * time, and turns media's errors into the helper codes the bridge maps.
 * A new ready line (a restarted helper) is announced as `helper.restarted`,
 * because the new process knows none of the old handles.
 */
import {
  MediaCancelled,
  MediaTimeout,
  SidecarNotFound,
  type JsonLineEventSidecar,
  type JsonValue,
} from '@taalcut/media';
import type { TaalcutError } from '@taalcut/core';
import { abortError, HelperRequestError, sanitiseHelperCode } from './failures';
import { helperReadySchema } from './map';

export interface HelperEvent {
  readonly name: string;
  readonly payload: unknown;
}

export interface HelperEndpoint {
  /** Resolves with the result; rejects with a HelperRequestError, or an AbortError when `signal` fired. */
  request(
    method: string,
    params: Readonly<Record<string, string | number | boolean | null>>,
    signal: AbortSignal,
  ): Promise<unknown>;
  onEvent(listener: (event: HelperEvent) => void): () => void;
  close(): Promise<void>;
}

/** Synthetic event: the helper process was replaced, so every handle and session is gone. */
export const HELPER_RESTARTED = 'helper.restarted';

/**
 * Per method, how long the bridge waits. The helper bounds its own work: `devices.open` waits up to
 * 120 s for Trust and the catalogue, a thumbnail up to 60 s. A download has no limit here: a 4K
 * ProRes clip over Lightning takes minutes, and the helper ends a stalled one itself.
 */
const TIMEOUT_MS: Readonly<Record<string, number>> = {
  'devices.start': 30_000,
  'devices.open': 150_000,
  'devices.list': 60_000,
  'devices.thumbnail': 90_000,
  'devices.ptp': 25_000,
  'devices.cancel': 10_000,
  'devices.close': 10_000,
};

export function createHelperEndpoint(sidecar: JsonLineEventSidecar): HelperEndpoint {
  const listeners = new Set<(event: HelperEvent) => void>();
  let lastReady: JsonValue | undefined;

  const emit = (event: HelperEvent): void => {
    for (const listener of listeners) listener(event);
  };
  sidecar.onEvent((event) => emit({ name: event.name, payload: event.data }));

  const ensureReady = async (): Promise<void> => {
    const ready = await sidecar.ready();
    if (!ready.ok) throw helperError(ready.error);
    const refused = refusal(ready.value);
    if (refused) throw new HelperRequestError(refused);
    const restarted = lastReady !== undefined && lastReady !== ready.value;
    lastReady = ready.value;
    if (restarted) emit({ name: HELPER_RESTARTED, payload: {} });
  };

  return {
    async request(method, params, signal) {
      if (signal.aborted) throw abortError();
      await ensureReady();
      if (signal.aborted) throw abortError();
      const timeoutMs = TIMEOUT_MS[method];
      const result = await sidecar.request(method, params, {
        signal,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      });
      if (result.ok) return result.value;
      if (signal.aborted) throw abortError();
      throw helperError(result.error);
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close: () => sidecar.close(),
  };
}

/** Why a ready line is not one this bridge can talk to, or undefined when it is. */
function refusal(value: JsonValue): string | undefined {
  const parsed = helperReadySchema.safeParse(value);
  if (!parsed.success) return 'helper.bad_request';
  const ready = parsed.data;
  if (ready.protocol !== 2) return 'helper.service_version';
  if (ready.services !== undefined && !ready.services.includes('devices'))
    return 'helper.service_not_started';
  const version = ready.serviceVersions?.devices;
  if (version !== undefined && version < 1) return 'helper.service_version';
  return undefined;
}

/** Media's sidecar errors as the helper code the bridge maps (never a path or a message). */
function helperError(error: TaalcutError): HelperRequestError {
  if (error.code === MediaCancelled.code) return new HelperRequestError('helper.cancelled');
  if (error.code === MediaTimeout.code) return new HelperRequestError('helper.timeout');
  if (error.code === SidecarNotFound.code) return new HelperRequestError('helper.not_found');
  const code = error.params?.helperCode;
  if (typeof code === 'string') return new HelperRequestError(sanitiseHelperCode(code));
  return new HelperRequestError('devices.session_failed');
}
