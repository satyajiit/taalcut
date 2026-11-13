// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { isTaalcutError, toTaalcutError, type TaalcutError } from '@taalcut/core';

/**
 * Why a page didn't show, as far as the window can tell from what was thrown:
 * - code: the page's own code didn't arrive (a chunk failed to load); reloading the window fetches it again
 * - known: a Taalcut error reached the page; its sentence names the cause, and it may carry its fix
 * - bug: anything else, a mistake in Taalcut's code; reported as `core.unknown` with the thrown name only
 */
export type PageErrorCause =
  | { readonly kind: 'code'; readonly error: TaalcutError }
  | { readonly kind: 'known'; readonly error: TaalcutError }
  | { readonly kind: 'bug'; readonly error: TaalcutError };

/** What browsers say when a lazily imported module fails to load (Chromium, WebKit, Firefox) or a chunk 404s. */
const MISSING_CODE =
  /dynamically imported module|importing a module script failed|error loading dynamically imported module|unable to preload css/i;

export function pageErrorCause(thrown: unknown): PageErrorCause {
  if (isTaalcutError(thrown)) return { kind: 'known', error: thrown };
  const error = toTaalcutError(thrown);
  const missing =
    thrown instanceof Error && (thrown.name === 'ChunkLoadError' || MISSING_CODE.test(thrown.message));
  return { kind: missing ? 'code' : 'bug', error };
}
