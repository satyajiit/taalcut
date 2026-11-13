// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { create } from 'zustand';
import type { PlatformId } from '#content/schema';
import type { EmailProblem } from '#lib/email';
import type { WriteCause, WriteOutcome } from '#lib/firebase/outcome';

/**
 * The waitlist forms' state (lane L3). A page can hold two forms (the hero and the closing band), so it comes in two
 * parts:
 *
 * - **Shared** (this store): the typed address, the page form's "what you make", and `joined`. A sign-up in one form
 *   shows "You're on the list." in every form on the page.
 * - **Each form's own** (`stepForm`, kept by each form with `useReducer`): its status, the address problem it shows
 *   and why its send failed. A problem in the hero never shows in the band, and the reverse.
 *
 * A repeat sign-up joins like a new one, so a form never says whether an address is already on the list.
 */
export type WaitlistStatus = 'idle' | 'invalid' | 'submitting' | 'success' | 'error' | 'offline';

/** What people make, offered as an optional choice; stored as the id. */
export const MAKES = ['travel', 'food', 'product', 'fitness', 'day-in-life', 'other'] as const;
export type Make = (typeof MAKES)[number];

export interface WaitlistState {
  readonly email: string;
  readonly platforms: readonly PlatformId[];
  readonly make: Make | null;
  /** On the list, from any form on the page. */
  readonly joined: boolean;
}

export interface WaitlistActions {
  setEmail(email: string): void;
  togglePlatform(id: PlatformId): void;
  setMake(make: Make | null): void;
  join(): void;
  reset(): void;
}

export const initialWaitlistState: WaitlistState = {
  email: '',
  platforms: [],
  make: null,
  joined: false,
};

export const useWaitlistStore = create<WaitlistState & WaitlistActions>()((set, get) => ({
  ...initialWaitlistState,
  setEmail(email) {
    set({ email });
  },
  togglePlatform(id) {
    const has = get().platforms.includes(id);
    set({ platforms: has ? get().platforms.filter((p) => p !== id) : [...get().platforms, id] });
  },
  setMake(make) {
    set({ make });
  },
  join() {
    set({ joined: true });
  },
  reset() {
    set(initialWaitlistState);
  },
}));

/** One form's status before the page joins; `success` comes from the shared `joined`. */
export type WaitlistFormStatus = Exclude<WaitlistStatus, 'success'>;

/** One form's own state. */
export interface WaitlistFormState {
  readonly status: WaitlistFormStatus;
  /** The address problem this form shows, after its own check. */
  readonly problem: EmailProblem | null;
  /** Why this form's last send failed. */
  readonly cause: WriteCause | null;
}

export type WaitlistFormEvent =
  /** The form checked the address before sending. */
  | { readonly type: 'checked'; readonly problem: EmailProblem | null }
  /** The address changed, in this form or another one on the page. */
  | { readonly type: 'typed' }
  | { readonly type: 'sending' }
  | { readonly type: 'answered'; readonly outcome: WriteOutcome };

export const initialFormState: WaitlistFormState = { status: 'idle', problem: null, cause: null };

/** One form's next state. Pure, so each step has a test. */
export function stepForm(state: WaitlistFormState, event: WaitlistFormEvent): WaitlistFormState {
  switch (event.type) {
    case 'checked':
      return event.problem ? { status: 'invalid', problem: event.problem, cause: null } : state;
    case 'typed':
      // Typing clears a shown problem: the field never scolds while someone is still writing.
      return state.status === 'invalid' ? initialFormState : state;
    case 'sending':
      return { status: 'submitting', problem: null, cause: null };
    case 'answered':
      if (event.outcome.kind === 'ok') return initialFormState;
      if (event.outcome.kind === 'offline') return { status: 'offline', problem: null, cause: null };
      return { status: 'error', problem: null, cause: event.outcome.cause };
  }
}
