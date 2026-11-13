// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  callRpc,
  ONBOARDING_COMMANDS,
  type OnboardingBranch,
  type OnboardingProgress,
  type TaalcutError,
  type TelemetryEvent,
} from '@taalcut/core';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBackend } from '../backend/backend';
import { useCommand } from '../backend/use-command';
import { useRpcQuery, type Loadable } from '../backend/use-rpc';
import { usePlaySound } from '../features/sounds/interface-sounds';
import { writeLaunchHint } from './launch-hint';
import { buildTerms, nextStep, previousStep, stepsFor, type OnboardingStep } from './steps';

export interface OnboardingSteps {
  readonly steps: readonly OnboardingStep[];
  /** The build said which terms it asks for. Until then the steps lack any terms step. */
  readonly ready: boolean;
  /** The build's channel couldn't be read: the terms step is unknown until `reload` answers. */
  readonly error: TaalcutError | null;
  reload(): void;
}

/**
 * Which steps this build shows: the alpha step on alpha and internal builds, the beta step on beta builds and on
 * the beta channel (P3-B14).
 */
export function useOnboardingSteps(): OnboardingSteps {
  const backend = useBackend();
  const updates = useRpcQuery((signal) => backend.updates.state(undefined, { signal }), [backend]);
  const terms = buildTerms(updates.data);
  const known = updates.data !== undefined;
  const error = known ? null : (updates.error ?? null);
  const { reload } = updates;
  return useMemo(
    () => ({ steps: stepsFor(terms), ready: known, error, reload }),
    // The two flags are all that matter.
    [terms.alpha, terms.beta, known, error, reload],
  );
}

/**
 * First run's saved progress, read once when a step opens: where inside it the person was (resume). A failed read
 * only loses the resume: the step opens on its default way.
 */
export function useOnboardingProgress(): Loadable<OnboardingProgress> {
  const backend = useBackend();
  return useRpcQuery((signal) => backend.onboarding.state(undefined, { signal }), [backend]);
}

/** Records a window telemetry event; the agent keeps it only with usage counts on (and never under Local only). */
export function useTelemetry() {
  const backend = useBackend();
  return useCallback((event: TelemetryEvent) => void callRpc(backend.telemetry.record({ event })), [backend]);
}

/**
 * One first-run step's way on and way out (P2-X4, P3-B3). Progress is saved as you go (`onboarding.setProgress`,
 * the person's own command) with the branch inside the step (the sign-in path, the phone method, the starter
 * picker), so quitting resumes there; leaving a step records `onboarding.step` with its time, and choosing a
 * branch records `onboarding.branch` (both kept only when you allowed usage counts).
 */
export function useOnboardingStep(step: OnboardingStep) {
  const navigate = useNavigate();
  const playSound = usePlaySound();
  const { run: dispatch } = useCommand();
  const record = useTelemetry();
  const build = useOnboardingSteps();
  const { steps } = build;
  const enteredAt = useRef(Date.now());
  const [leaving, setLeaving] = useState<'continue' | 'skip' | null>(null);

  const recordStep = useCallback(
    (skipped: boolean) =>
      record({ name: 'onboarding.step', step, ms: Math.max(0, Date.now() - enteredAt.current), skipped }),
    [record, step],
  );
  const save = useCallback(
    (
      to: OnboardingStep,
      extra: { completed?: boolean; via?: 'finished' | 'skipped'; branch?: OnboardingBranch } = {},
    ) => dispatch({ name: ONBOARDING_COMMANDS.setProgress, payload: { step: to, ...extra } }),
    [dispatch],
  );

  // Opening a step (Get started, the rail, a resume) is where first run carries on from next time.
  useEffect(() => {
    void save(step);
  }, [save, step]);

  const next = nextStep(step, steps);
  const previous = previousStep(step, steps);
  /** On to the next step, or out of first run after the last one. */
  const continueOn = useCallback(
    async (to?: OnboardingStep) => {
      setLeaving('continue');
      recordStep(false);
      const target = to ?? next;
      const saved = await save(target ?? step, target ? {} : { completed: true, via: 'finished' });
      if (!saved.ok) {
        setLeaving(null);
        return;
      }
      if (target) {
        await navigate({ to: '/onboarding/$step', params: { step: target } });
      } else {
        writeLaunchHint('app');
        await navigate({ to: '/chat' });
      }
      playSound(target ? 'editApplied' : 'complete');
      setLeaving(null);
    },
    [next, navigate, recordStep, save, step, playSound],
  );

  /** Out of first run from here; it doesn't open again at launch (Settings › About › Run setup again does). */
  const skip = useCallback(async () => {
    setLeaving('skip');
    recordStep(true);
    await save(step, { completed: true, via: 'skipped' });
    writeLaunchHint('app');
    await navigate({ to: '/chat' });
    setLeaving(null);
  }, [navigate, recordStep, save, step]);

  /** The last step started a chat: first run is done (the caller navigates). */
  const finish = useCallback(async () => {
    recordStep(false);
    const saved = await save(step, { completed: true, via: 'finished' });
    if (saved.ok) {
      writeLaunchHint('app');
      playSound('complete');
    }
  }, [recordStep, save, step, playSound]);

  /** The person chose a way inside this step: kept for a resume, and counted. */
  const choose = useCallback(
    (branch: OnboardingBranch) => {
      void save(step, { branch });
      const chosen = branch.thinking ?? branch.source ?? (branch.starterPicker ? 'starter' : undefined);
      if (chosen) record({ name: 'onboarding.branch', step, branch: chosen });
    },
    [record, save, step],
  );

  /**
   * Back (a link to the step before, or the welcome from the first) leaves the step too: its time is counted.
   * Nothing is undone; the way chosen there reopens.
   */
  const leaveBack = useCallback(() => recordStep(false), [recordStep]);

  return { steps, build, next, previous, continueOn, leaveBack, skip, finish, choose, leaving };
}
