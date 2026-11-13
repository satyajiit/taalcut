// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * First run's progress (P2-X4, P3-B3): appContract.onboarding's state, `onboarding.setProgress` (person-only, no
 * inverse) with the branch inside a step and how first run ended, and `onboarding.reset` for Run setup again,
 * whose inverse puts the previous progress back.
 */
import {
  defineCommand,
  ok,
  ONBOARDING_COMMANDS,
  onboardingCommandPayloads,
  PERSON_SOURCES,
  type AnyCommand,
  type OnboardingProgress,
} from '@taalcut/core';

export type OnboardingScenario = 'done' | 'fresh' | 'midway';

export interface FakeProgress {
  progress(): OnboardingProgress;
  readonly commands: readonly [AnyCommand, AnyCommand];
}

const notStarted = (): OnboardingProgress => ({
  step: null,
  startedAt: null,
  completedAt: null,
  branch: {},
  completedVia: null,
});

/** done: finished yesterday; midway: stopped at sources two minutes ago; fresh: never opened. */
export function scenarioProgress(scenario: OnboardingScenario, now: number): OnboardingProgress {
  if (scenario === 'done')
    return {
      step: 'first-video',
      startedAt: now - 86_400_000,
      completedAt: now - 86_000_000,
      branch: {},
      completedVia: 'finished',
    };
  if (scenario === 'midway')
    return { step: 'sources', startedAt: now - 120_000, completedAt: null, branch: {}, completedVia: null };
  return notStarted();
}

/** `persist` is called with the progress after each change, to keep it across reloads. */
export function createFakeProgress(
  now: () => number,
  initial: OnboardingProgress,
  persist?: (progress: OnboardingProgress) => void,
): FakeProgress {
  let progress = initial;
  const setProgress = defineCommand({
    name: ONBOARDING_COMMANDS.setProgress,
    payload: onboardingCommandPayloads[ONBOARDING_COMMANDS.setProgress],
    sideEffect: 'write',
    sources: PERSON_SOURCES,
    project: () => null,
    handle({ step, completed, via, branch }) {
      // First run finished (by the last step or Skip) is never undone by a resume.
      const ending = progress.completedAt !== null;
      progress = {
        ...progress,
        step,
        startedAt: progress.startedAt ?? now(),
        completedAt: completed && !ending ? now() : progress.completedAt,
        branch: branch ? { ...progress.branch, ...branch } : progress.branch,
        completedVia: completed && !ending ? (via ?? 'finished') : progress.completedVia,
      };
      persist?.(progress);
      return ok({ result: progress });
    },
  });
  const reset = defineCommand({
    name: ONBOARDING_COMMANDS.reset,
    payload: onboardingCommandPayloads[ONBOARDING_COMMANDS.reset],
    sideEffect: 'write',
    sources: PERSON_SOURCES,
    project: () => null,
    handle() {
      const before = progress;
      progress = notStarted();
      persist?.(progress);
      return ok({
        result: progress,
        inverse: {
          name: ONBOARDING_COMMANDS.setProgress,
          payload: {
            step: before.step ?? 'thinking',
            ...(before.completedAt !== null
              ? { completed: true, via: before.completedVia ?? 'finished' }
              : {}),
            branch: before.branch,
          },
        },
      });
    },
  });
  return { progress: () => progress, commands: [setProgress, reset] };
}
