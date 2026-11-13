// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: first run's finish, its one primary (UX4) · system: DESIGN.md "First run", _orch/ux4/specs/design-onb.md
 * "Make my first video": the last step's marigold fill at the actions' start, after Back, with the make-a-video glyph.
 *   The step's own setup (a reel, a starter or a description) says when it may be pressed and what it starts; the
 *   button stands still in the actions row, so the way on never scrolls away.
 * states: default · hover · focus (base ring) · active (gives 2 %) · disabled (nothing chosen yet, or nothing can
 *   think yet: the reason under the actions) · loading (spins while first run is saved and the chat opens) · error
 *   (the start failed: the cause under the actions, the button stays) · success (the chat takes over)
 */
import { Trans } from '@lingui/react/macro';
import { Button, VERB_ICONS } from '@taalcut/ui';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

/** What the finish's setup says about its one primary. */
export interface FinishState {
  readonly ready: boolean;
  /** One plain line under the off button: what turns it on. */
  readonly reason?: string | undefined;
  readonly busy: boolean;
}

interface FinishContext {
  readonly state: FinishState;
  readonly set: (state: FinishState) => void;
  readonly start: RefObject<(() => void) | null>;
}

const OFF: FinishState = { ready: false, busy: false };
const Context = createContext<FinishContext | null>(null);

/** Holds the finish's state between its setup (in the step's content) and its button (in the actions). */
export function FinishProvider({ children }: { children: ReactNode }) {
  const [state, set] = useState<FinishState>(OFF);
  const start = useRef<(() => void) | null>(null);
  return <Context.Provider value={{ state, set, start }}>{children}</Context.Provider>;
}

/** The setup says whether the finish may go, why not, and what pressing it starts. */
export function useFinishGate(state: FinishState, start: () => void): void {
  const context = useContext(Context);
  const set = context?.set;
  const ref = context?.start;
  useEffect(() => {
    if (ref) ref.current = start;
  });
  const { ready, reason, busy } = state;
  useEffect(() => {
    set?.({ ready, reason, busy });
  }, [set, ready, reason, busy]);
  useEffect(() => () => set?.(OFF), [set]);
}

/** The finish's reason, for the actions row's line. */
export function useFinishReason(): string | undefined {
  const state = useContext(Context)?.state;
  return state && !state.ready && !state.busy ? state.reason : undefined;
}

/** "Make my first video": the step's setup decides when and what. */
export function MakeFirstVideo() {
  const context = useContext(Context);
  const state = context?.state ?? OFF;
  return (
    <Button
      variant="primary"
      size="lg"
      data-action="make-first-video"
      icon={VERB_ICONS.makeVideo}
      disabled={!state.ready}
      loading={state.busy}
      onClick={() => context?.start.current?.()}
    >
      <Trans>Make my first video</Trans>
    </Button>
  );
}
