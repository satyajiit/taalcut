// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Errors for the mac helper sidecar. They live here, not in src/errors.ts,
 * so the media lane can keep editing that file.
 */
import { defineError, type TaalcutError } from '@taalcut/core';
import type { FileParams } from '../errors';

/** The helper crashed, or a helper error asked the caller to retry. */
export const SidecarFailed = defineError<{ helperCode?: string }>('media.sidecar_failed', {
  retryable: true,
});

/** The helper refused the request. `helperCode` is the code from its error object. */
export const SidecarRejected = defineError<{ helperCode: string }>('media.sidecar_rejected');

/** The helper's own failure code (`embed.model_load_failed`, …) of a sidecar failure, else the failure's code. */
export function helperCode(error: Pick<TaalcutError, 'code' | 'params'>): string {
  const code = error.params?.['helperCode'];
  return typeof code === 'string' ? code : error.code;
}

/** The helper binary is not where the resolver was told to look. */
export const SidecarNotFound = defineError<{ binary: string }>('media.sidecar_not_found');

/** A bundled helper's signature-free sha256 is not the pin its app was packaged with, or the app has no pin. */
export const SidecarPinMismatch = defineError<{ binary: string }>('media.sidecar_pin_mismatch');

/** ImageIO or the probe could not read still metadata for this file. */
export const StillUnreadable = defineError<FileParams>('media.still_unreadable');
