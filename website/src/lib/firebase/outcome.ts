// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a form shows after a write, from the error the SDK threw (or didn't). Pure, so every branch has a test.
 * The words for each cause live with the form's (content/forms.ts).
 */

export type WriteCause =
  /** App Check couldn't vouch for this browser, or the server refused the write. */
  | 'refused'
  /** Too many writes at once (Firestore's resource-exhausted). */
  | 'busy'
  /** No answer within the form's wait. */
  | 'timeout'
  /** The request never reached Firestore although the browser says it's online (a blocker, a captive portal). */
  | 'unreachable'
  /** The part of the page that sends the form didn't download. */
  | 'load-failed'
  | 'unknown';

export type WriteOutcome =
  | { readonly kind: 'ok' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'error'; readonly cause: WriteCause };

/** How long a form waits for Firestore before it says so. */
export const WRITE_TIMEOUT_MS = 15_000;

/** Thrown by the forms' own steps, so the mapping below can tell them from the SDK's errors. */
export class FormStepError extends Error {
  constructor(readonly code: 'timeout' | 'load-failed' | 'app-check') {
    super(code);
    this.name = 'FormStepError';
  }
}

export interface OutcomeContext {
  /** `navigator.onLine` when the write failed. */
  readonly online: boolean;
}

function codeOf(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string')
    return error.code;
  return undefined;
}

export function outcomeFromError(error: unknown, context: OutcomeContext): WriteOutcome {
  if (error === undefined) return { kind: 'ok' };
  if (!context.online) return { kind: 'offline' };
  const code = codeOf(error);
  switch (code) {
    case 'permission-denied':
    case 'app-check':
    case 'unauthenticated':
      return { kind: 'error', cause: 'refused' };
    case 'unavailable':
      return { kind: 'offline' };
    case 'resource-exhausted':
      return { kind: 'error', cause: 'busy' };
    case 'timeout':
    case 'deadline-exceeded':
      return { kind: 'error', cause: 'timeout' };
    case 'load-failed':
      return { kind: 'error', cause: 'load-failed' };
    default: {
      // Firestore Lite reports a fetch that never got an answer as `unknown` with the browser's own message.
      const message = error instanceof Error ? error.message : String(error);
      if (/fetch|network|load failed/i.test(message)) return { kind: 'error', cause: 'unreachable' };
      return { kind: 'error', cause: 'unknown' };
    }
  }
}
