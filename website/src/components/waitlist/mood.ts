// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { KaatuMood } from '#components/kaatu/kaatu';
import { FORMS_OPEN } from '#lib/firebase/config';
import type { WaitlistStatus } from '#stores/waitlist';

/**
 * Kaatu's mood beside a waitlist form, from the form's state (WEB1 plan › Kaatu): it glances at the field while
 * someone types, thinks while the form sends, is delighted on the list and says oops on a problem. While the list is
 * closed it sleeps. Pure (no JSX), so the mapping has a test.
 */
export function moodFor(
  status: WaitlistStatus,
  focused: boolean,
  rest: KaatuMood,
  open = FORMS_OPEN,
): KaatuMood {
  if (!open) return 'asleep';
  switch (status) {
    case 'submitting':
      return 'thinking';
    case 'success':
      return 'delighted';
    case 'invalid':
    case 'error':
    case 'offline':
      return 'oops';
    default:
      return focused ? 'glance' : rest;
  }
}
