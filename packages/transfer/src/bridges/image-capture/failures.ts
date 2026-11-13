// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Helper failures become transfer errors. `detail` is a helper code only
 * (`devices.item_empty`), never a path, a name or a serial.
 */
import { CancelledError, type TaalcutError } from '@taalcut/core';
import type { DeviceAccess } from '../../usb/bridge';
import { BridgeFailed, DeviceGone, DeviceLocked } from '../../usb/errors';

const SAFE_CODE = /^(?:devices|helper)\.[a-z0-9_]{1,48}$/;
const EMPTY_OR_FAILED = new Set(['devices.item_empty', 'devices.download_failed']);

export class HelperRequestError extends Error {
  readonly code: string;

  constructor(code: string) {
    const safe = sanitiseHelperCode(code);
    super(safe);
    this.name = 'HelperRequestError';
    this.code = safe;
  }
}

export interface FailureContext {
  readonly removed: boolean;
  readonly access: DeviceAccess;
}

export function sanitiseHelperCode(code: string): string {
  return SAFE_CODE.test(code) ? code : 'devices.session_failed';
}

export function helperCodeOf(cause: unknown): string | undefined {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return undefined;
  return typeof cause.code === 'string' ? sanitiseHelperCode(cause.code) : undefined;
}

export function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError';
}

export function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

export function bridgeFailure(cause: unknown, context?: FailureContext): TaalcutError {
  if (isAbortError(cause)) return CancelledError();
  const code = cause instanceof HelperRequestError ? cause.code : helperCodeOf(cause);
  if (code && EMPTY_OR_FAILED.has(code)) return BridgeFailed(undefined, { detail: code });
  if (context?.removed) return DeviceGone();
  if (code === 'devices.locked' || context?.access.state === 'locked') return DeviceLocked();
  return BridgeFailed(undefined, { detail: code ?? 'devices.session_failed' });
}
