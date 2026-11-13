// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { TaalcutError } from '@taalcut/core';

/**
 * What a card knows about a stored thing it names (protocol rule 1, UX round 1):
 * - `loading`: not here yet (`last` is what it showed before a Try again, if anything);
 * - `ready`: as it is now;
 * - `gone`: deleted, so the card keeps its snapshot and says "This was deleted.";
 * - `off`: nothing watches it here (the kit's own gallery), so the card keeps its snapshot quietly;
 * - `failed`: the read or the stream broke for now (a restart, a dropped port). The last value stays on screen
 *   with its actions, and the card shows the cause with Try again. Never "deleted".
 */
export type LiveRead<T> =
  | { readonly status: 'loading'; readonly last: T | null }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'gone' }
  | { readonly status: 'off' }
  | { readonly status: 'failed'; readonly error: TaalcutError; readonly last: T | null };

/** A live read and the way to start it again after a failure. */
export interface LiveReadState<T> {
  readonly read: LiveRead<T>;
  /** Watches (or reads) again from the start; the last value stays on screen meanwhile. */
  readonly retry: () => void;
}

/** A read a card could not make for now: not "gone", so the card says why and offers Try again. */
export interface CardReadFailure {
  readonly failed: TaalcutError;
}

export function isReadFailure(value: unknown): value is CardReadFailure {
  return typeof value === 'object' && value !== null && 'failed' in value;
}

/** What to draw: the newest value, or the last one shown before a failure or a Try again. */
export function liveValue<T>(read: LiveRead<T>): T | null {
  switch (read.status) {
    case 'ready':
      return read.value;
    case 'loading':
    case 'failed':
      return read.last;
    case 'gone':
    case 'off':
      return null;
  }
}

/**
 * The older shape cards and other lanes still read: undefined while loading (or failed with nothing to show, so a
 * failure never reads as "deleted"), null when gone or not watched, else the value.
 */
export function legacyValue<T>(read: LiveRead<T>): T | null | undefined {
  if (read.status === 'gone' || read.status === 'off') return null;
  return liveValue(read) ?? undefined;
}

/**
 * A rejected promise is a bug on the other side, not a fact about the thing: shown as the generic cause, which
 * Try again may clear. The kit imports core's types only, so the error is spelled out here.
 */
export const READ_REJECTED: TaalcutError = {
  code: 'core.unknown',
  messageKey: 'errors.core.unknown',
  retryable: true,
};
