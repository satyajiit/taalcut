// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useRouterState } from '@tanstack/react-router';

/**
 * Changes each time a navigation lands, even on the page already on screen. A page that reads something once, with
 * no event to tell it of a change, lists this beside its other inputs so every arrival reads it again. Mounting
 * isn't enough: a page picked again before the page you were heading to has arrived (Usage, then Privacy, quickly)
 * stays mounted, since the other never showed.
 */
export function useArrival(): string | undefined {
  return useRouterState({
    select: (state) => state.resolvedLocation?.state.__TSR_key ?? state.resolvedLocation?.href,
  });
}
