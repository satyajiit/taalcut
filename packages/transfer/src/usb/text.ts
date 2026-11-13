// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { PublicError, TaalcutError } from '@taalcut/core';

export function clipText(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return '';
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

/** Drop developer `detail` before a run or a log leaves the process. */
export function publicError(error: TaalcutError): PublicError {
  return {
    code: error.code,
    messageKey: error.messageKey,
    retryable: error.retryable,
    ...(error.params ? { params: error.params } : {}),
    ...(error.fix ? { fix: error.fix } : {}),
  };
}

/** deviceKey, upload id, extension, and size. Never a name, path, or serial. */
export function safeLine(deviceKey: string, uploadId: string, extension: string, size: number): string {
  return `usb ${deviceKey} ${uploadId} ${extension} ${size}`;
}
