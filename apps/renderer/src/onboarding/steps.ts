// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import {
  ONBOARDING_STEP_IDS,
  type OnboardingStepId,
  type PublicUpdateChannel,
  type UpdateChannel,
} from '@taalcut/core';
import type { HostPlatform } from '@taalcut/ui';
import { notFound } from '@tanstack/react-router';

/**
 * First-run steps after the welcome (UX4, the owner's order: footage first), in order. Each is /onboarding/<id>:
 * where your videos are (the import shows there as it runs), the terms when the build has them, then a reel or a
 * starter for the first video. `alpha` shows only in alpha and internal builds, `beta` in beta builds and on the
 * beta channel. The terms sit after your videos so the import runs while you read them, and before the last step,
 * which ends first run. How Taalcut thinks and this Mac's check are no longer steps: they run quietly, and anything
 * that needs you surfaces on the last step (quiet-checks.tsx).
 */
export const ONBOARDING_STEPS = [
  'sources',
  'alpha',
  'beta',
  'first-video',
] as const satisfies readonly OnboardingStepId[];

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** The steps of the old order (core keeps their ids, so a saved progress and an old link still parse). */
export type RetiredStep = Exclude<OnboardingStepId, OnboardingStep>;

/**
 * Where an old step's link goes: to the step that now holds what it showed. How Taalcut thinks and this Mac's check
 * surface on the last step when they need you; the import shows on Your videos.
 */
const RETIRED_LINKS: Readonly<Record<RetiredStep, OnboardingStep>> = {
  thinking: 'first-video',
  hardware: 'first-video',
  import: 'sources',
};

const isLive = (id: OnboardingStepId): id is OnboardingStep =>
  (ONBOARDING_STEPS as readonly OnboardingStepId[]).includes(id);

/** The step an old step's address opens now (`/onboarding/hardware` → the last step). */
export function linkedStep(id: OnboardingStepId): OnboardingStep {
  return isLive(id) ? id : RETIRED_LINKS[id];
}

/**
 * The step a saved progress resumes on. A progress saved at an old step came before footage in the old order (or,
 * for the import, during it), so it resumes on Your videos.
 */
export function resumeStep(id: OnboardingStepId): OnboardingStep {
  return isLive(id) ? id : 'sources';
}

/** Which terms this build asks for: the build's update channel and, on a public build, the person's choice. */
export interface BuildTerms {
  readonly alpha: boolean;
  readonly beta: boolean;
}

export function buildTerms(
  update: { readonly channel: UpdateChannel | null; readonly choice: PublicUpdateChannel | null } | undefined,
): BuildTerms {
  const channel = update?.channel ?? null;
  return {
    alpha: channel === 'alpha' || channel === 'internal',
    beta: channel === 'beta' || update?.choice === 'beta',
  };
}

/** The steps this build shows. */
export function stepsFor(terms: BuildTerms): readonly OnboardingStep[] {
  return ONBOARDING_STEPS.filter(
    (step) => (step !== 'alpha' || terms.alpha) && (step !== 'beta' || (terms.beta && !terms.alpha)),
  );
}

export interface StepCopy {
  /** The step in the list of steps: two or three words. */
  name: MessageDescriptor;
  title: MessageDescriptor;
  body: MessageDescriptor;
}

export const STEP_COPY: Record<OnboardingStep, StepCopy> = {
  sources: {
    name: msg`Your videos`,
    title: msg`Where are your videos?`,
    body: msg({
      id: 'onboarding.sources.body',
      message: 'A folder on this Mac, or your phone over Wi-Fi or a cable. No app needed on the phone.',
    }),
  },
  alpha: {
    name: msg`The alpha`,
    title: msg`You’re trying an early version`,
    body: msg`Things will break, and your notes shape what comes next. Sharing is up to you: both switches start off.`,
  },
  beta: {
    name: msg({ id: 'onboarding.beta.name', message: 'The beta' }),
    title: msg({ id: 'onboarding.beta.title', message: 'You’re using the public beta' }),
    body: msg({
      id: 'onboarding.beta.body',
      message: 'What the beta means for you, and what you choose to share.',
    }),
  },
  'first-video': {
    name: msg`First video`,
    title: msg`Make your first video`,
    body: msg({
      id: 'onboarding.finish.body',
      message:
        'Paste a reel you like and Taalcut cuts your clips to its beat. No reel to hand? Pick a starter.',
    }),
  },
};

/** The steps that name the Mac, off a Mac (LNX1, UX3): the same steps, for "this computer". */
const COMPUTER_COPY: Partial<Record<OnboardingStep, StepCopy>> = {
  sources: {
    ...STEP_COPY.sources,
    body: msg({
      id: 'onboarding.sources.body.computer',
      message: 'A folder on this computer, or your phone over Wi-Fi or a cable. No app needed on the phone.',
    }),
  },
};

/** A step's words on this platform. */
export function stepCopy(step: OnboardingStep, platform: HostPlatform): StepCopy {
  return (platform === 'mac' ? undefined : COMPUTER_COPY[step]) ?? STEP_COPY[step];
}

/**
 * Validates the URL segment: a step of first run, or an old step's id (the route sends that on to its step).
 * Anything else is the not-found page.
 */
export function parseStep(value: string): OnboardingStepId {
  const step = ONBOARDING_STEP_IDS.find((candidate) => candidate === value);
  if (!step) throw notFound();
  return step;
}

export function nextStep(
  step: OnboardingStep,
  steps: readonly OnboardingStep[] = ONBOARDING_STEPS,
): OnboardingStep | undefined {
  const index = steps.indexOf(step);
  return index < 0
    ? steps.find((each) => ONBOARDING_STEPS.indexOf(each) > ONBOARDING_STEPS.indexOf(step))
    : steps[index + 1];
}

/** The step before this one in the build's list, or undefined on the first (Back then goes to the welcome). */
export function previousStep(
  step: OnboardingStep,
  steps: readonly OnboardingStep[] = ONBOARDING_STEPS,
): OnboardingStep | undefined {
  const order = ONBOARDING_STEPS.indexOf(step);
  return steps.findLast((each) => ONBOARDING_STEPS.indexOf(each) < order);
}

/**
 * The steps the rail shows: the build's, plus the open one when the build doesn't list it (a terms step opened by
 * its URL in another build), in first run's order. So "Step N of M" is never "Step 0".
 */
export function railSteps(step: OnboardingStep, steps: readonly OnboardingStep[]): readonly OnboardingStep[] {
  return steps.includes(step)
    ? steps
    : ONBOARDING_STEPS.filter((each) => each === step || steps.includes(each));
}

/** Steps that come before the terms: the build has to say whether it has a terms step before they carry on. */
export function beforeTerms(step: OnboardingStep): boolean {
  return ONBOARDING_STEPS.indexOf(step) < ONBOARDING_STEPS.indexOf('alpha');
}

/** The steps that ask the person to agree to terms. */
export const isTermsStep = (step: OnboardingStep): boolean => step === 'alpha' || step === 'beta';
