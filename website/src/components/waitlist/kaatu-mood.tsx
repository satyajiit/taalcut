// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: waitlist Kaatu · Kaatu beside a waitlist form, reacting to it
 * mode: Persuade · system: WEB2 Remix Vernacular (Kaatu as a sticker character: decorative, aria-hidden, never over
 *   footage; it follows a near pointer and answers a click)
 * states: rest (the place's own mood) · glance (the field has focus) · thinking (sending) · delighted (on the list)
 *   · oops (a problem, an error or offline) · asleep (the waitlist isn't open in this build)
 * Kaatu follows the form beside it, never another form on the page: the form reports its own status and focus to
 * the provider around both. Lane L5 draws the moods; this only chooses one. */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Kaatu, type KaatuMood, type KaatuToward } from '#components/kaatu/kaatu';
import type { WaitlistStatus } from '#stores/waitlist';
import { moodFor } from './mood';

interface FormMood {
  readonly focused: boolean;
  readonly status: WaitlistStatus;
  readonly setFocused: (focused: boolean) => void;
  readonly setStatus: (status: WaitlistStatus) => void;
}

const MoodContext = createContext<FormMood | null>(null);

/** Wraps one form and its Kaatu, so Kaatu sees that form's state and when its field has focus. */
export function WaitlistMoodProvider({ children }: { readonly children: ReactNode }) {
  const [focused, setFocused] = useState(false);
  const [status, setStatus] = useState<WaitlistStatus>('idle');
  const value = useMemo(() => ({ focused, status, setFocused, setStatus }), [focused, status]);
  return <MoodContext.Provider value={value}>{children}</MoodContext.Provider>;
}

const ignore = () => undefined;

/**
 * The form's side: tells the Kaatu beside it the form's status, and returns how to report the field's focus. A form
 * outside a provider (the hero's) reports to nobody.
 */
export function useReportMood(status: WaitlistStatus): (focused: boolean) => void {
  const mood = useContext(MoodContext);
  const setStatus = mood?.setStatus;
  useEffect(() => {
    setStatus?.(status);
  }, [setStatus, status]);
  return mood?.setFocused ?? ignore;
}

export function WaitlistKaatu({
  rest = 'idle',
  size = 96,
  toward = 'right',
  className,
}: {
  readonly rest?: KaatuMood;
  readonly size?: number;
  readonly toward?: KaatuToward;
  readonly className?: string;
}) {
  const mood = useContext(MoodContext);
  return (
    <Kaatu
      mood={moodFor(mood?.status ?? 'idle', mood?.focused ?? false, rest)}
      size={size}
      toward={toward}
      interactive
      sticker
      className={className}
    />
  );
}
