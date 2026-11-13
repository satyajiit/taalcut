// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createContext, useContext, useEffect } from 'react';

/** Whether a step's Continue is on, and why not (docs/onboarding.md section 2, "Done when"). */
export interface StepGate {
  readonly ready: boolean;
  /** One plain line under the off Continue: what turns it on. */
  readonly reason?: string;
}

const OPEN: StepGate = { ready: true };
const StepGateContext = createContext<(gate: StepGate) => void>(() => undefined);

export const StepGateProvider = StepGateContext.Provider;

/** A step's setup says when its Continue may be pressed; open again when it goes. */
export function useStepGate(ready: boolean, reason?: string): void {
  const set = useContext(StepGateContext);
  useEffect(() => {
    set(ready ? OPEN : { ready, ...(reason ? { reason } : {}) });
  }, [set, ready, reason]);
  useEffect(() => () => set(OPEN), [set]);
}
