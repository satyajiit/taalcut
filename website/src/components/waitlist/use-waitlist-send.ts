// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

import { useCallback, useEffect, useReducer, useRef, type RefObject } from 'react';
import type { PlatformId } from '#content/schema';
import { emailProblem } from '#lib/email';
import { resolveSource, waitlistEntry } from '#lib/firebase/entries';
import { submitWaitlist } from '#lib/firebase/load';
import { initialFormState, stepForm, useWaitlistStore, type WaitlistStatus } from '#stores/waitlist';

/** The shortest the loading state shows, so a fast answer doesn't flash "Joining…" and Kaatu's thinking. */
const MIN_BUSY_MS = 450;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends one waitlist form and keeps that form's own state: its status, the address problem it shows and why its send
 * failed, so a problem in the hero never shows in the closing band. The store holds what the page's forms share: the
 * typed address and `joined`, so a sign-up in either form shows "You're on the list." in both. `picked` is the page
 * form's own platform choice (none ticked is a valid sign-up).
 */
export function useWaitlistSend({
  variant,
  source,
  platform,
  picked,
  field,
  success,
}: {
  readonly variant: 'inline' | 'page';
  readonly source: string | undefined;
  readonly platform: PlatformId | undefined;
  readonly picked: readonly PlatformId[];
  readonly field: RefObject<HTMLInputElement | null>;
  readonly success: RefObject<HTMLDivElement | null>;
}) {
  const [own, dispatch] = useReducer(stepForm, initialFormState);
  const email = useWaitlistStore((s) => s.email);
  const joined = useWaitlistStore((s) => s.joined);
  const sending = useRef(false);
  const sentHere = useRef(false);

  // A changed address clears this form's problem, whichever form it was typed in: the field shows the new one.
  useEffect(() => {
    dispatch({ type: 'typed' });
  }, [email]);

  // Focus follows the answer, only in the form that was sent: to the success line, which replaced the form.
  useEffect(() => {
    if (joined && sentHere.current) success.current?.focus();
  }, [joined, success]);

  const send = useCallback(async () => {
    const store = useWaitlistStore.getState();
    if (sending.current || store.joined) return;
    const problem = emailProblem(store.email);
    dispatch({ type: 'checked', problem });
    if (problem) {
      field.current?.focus();
      return;
    }
    const entry = waitlistEntry({
      email: store.email,
      // The page asks; an inline form sends the platform it was placed for, or none.
      platforms: variant === 'page' ? picked : platform ? [platform] : [],
      make: variant === 'page' ? store.make : null,
      source: resolveSource(window.location.search, source, variant === 'page' ? 'waitlist-page' : 'site'),
    });
    if (!entry) return;
    sending.current = true;
    sentHere.current = true;
    dispatch({ type: 'sending' });
    const [outcome] = await Promise.all([submitWaitlist(entry), wait(MIN_BUSY_MS)]);
    sending.current = false;
    if (outcome.kind === 'ok') useWaitlistStore.getState().join();
    dispatch({ type: 'answered', outcome });
  }, [field, picked, platform, source, variant]);

  const status: WaitlistStatus = joined ? 'success' : own.status;
  return { send, status, problem: own.problem, cause: own.cause };
}
