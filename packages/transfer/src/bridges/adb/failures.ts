// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How adb failures read. A phone that goes away mid-command shows up as a
 * WebUSB NetworkError, the daemon transport's "closed unexpectedly", or one
 * of the struct reader's "ended" errors when a sync socket stops halfway.
 * A per-path FAIL from the phone is `AdbSyncError`, which is not a gone phone.
 */
import { AdbSyncError } from '@yume-chan/adb';

const GONE_MESSAGES = new Set([
  'Connection closed unexpectedly',
  'ExactReadable ended',
  'The underlying readable was ended before the struct was fully deserialized',
  "The underlying readable doesn't contain any more struct",
]);

export function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function isConnectionGone(error: unknown): boolean {
  if (!(error instanceof Error) || error instanceof AdbSyncError) return false;
  return error.name === 'NetworkError' || GONE_MESSAGES.has(error.message);
}

/** The bridge's code for `BridgeFailed.detail`. Never a path, a serial or a key. */
export function adbFailureCode(error: unknown): string {
  if (error instanceof AdbSyncError) return 'sync';
  if (!(error instanceof Error)) return 'adb';
  if (error.name === 'AdbKeyRejected' || error.message === 'adb-key') return 'adb-key';
  return 'adb';
}

export function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

/** The part file could not take the bytes (a zero-byte write). ENOSPC arrives as the fs error itself. */
export class PartWriteError extends Error {
  override readonly name = 'PartWriteError';
  constructor() {
    super('part-write');
  }
}

export function isDiskFull(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false;
  return error.code === 'ENOSPC' || error.code === 'EDQUOT';
}

/** A Node fs failure on the Mac's side (it names a syscall), not something the phone said. */
export function isLocalFileError(error: unknown): boolean {
  return error instanceof Error && 'syscall' in error && typeof error.syscall === 'string';
}
