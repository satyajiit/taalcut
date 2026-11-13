// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { track } from '../analytics/load';
import { FORMS_OPEN } from './config';
import type { ContactEntry } from './entries';
import type * as SdkModule from './sdk';
import { FormStepError, outcomeFromError, WRITE_TIMEOUT_MS, type WriteOutcome } from './outcome';

/**
 * The contact form's way to Firebase. Nothing here imports the SDK: `sdk.ts` arrives through a dynamic import the
 * first time someone focuses the form's field or sends it, so a page that is only read never downloads Firebase.
 */

type Sdk = typeof SdkModule;

let pending: Promise<Sdk> | null = null;

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function loadSdk(): Promise<Sdk> {
  pending ??= import('./sdk').catch((error: unknown) => {
    // Forget the failure, so Try again downloads it again once the connection is back.
    pending = null;
    throw error;
  });
  return pending;
}

/** Starts the download on intent (a field's focus). Quiet: a failure shows up when the form is sent. */
export function preloadFirebase(): void {
  if (!FORMS_OPEN || !isOnline()) return;
  loadSdk().catch(() => undefined);
}

function withTimeout<T>(work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new FormStepError('timeout')), WRITE_TIMEOUT_MS);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function run(write: (sdk: Sdk) => Promise<void>): Promise<WriteOutcome> {
  if (!isOnline()) return { kind: 'offline' };
  try {
    let sdk: Sdk;
    try {
      sdk = await loadSdk();
    } catch {
      throw new FormStepError('load-failed');
    }
    await withTimeout(write(sdk));
    return { kind: 'ok' };
  } catch (error) {
    return outcomeFromError(error ?? new Error('unknown'), { online: isOnline() });
  }
}

/** Sends a message. Counted (lib/analytics) by its topic only, never by who sent it or what it says. */
export async function submitContact(entry: ContactEntry): Promise<WriteOutcome> {
  const outcome = await run((sdk) => sdk.writeContact(entry));
  if (outcome.kind === 'ok') track('contact_sent', { topic: entry.topic });
  return outcome;
}
