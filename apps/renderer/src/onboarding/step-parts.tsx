// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: a first-run step's setup and its Continue (UX4) · genre: atmospheric studio app · system: DESIGN.md
 *   v0.6 + _orch/ux4/specs/design-onb.md
 * what the step sets up (bones while the saved progress loads), then Continue: the screen's one marigold fill, with
 *   the way-on arrow after its words; on a terms step it says "Agree and continue" with the approve tick, and only
 *   moves on once the agreement is saved. The last step's primary is the finish's (finish-gate.tsx).
 * states: default · hover/focus/active (Button) · disabled (the step isn't done: the gate's reason under it; before
 *   the terms, until the build says whether it has a terms step) · loading (Continue spins while the agreement is
 *   saved and the next step opens) · error (the agreement wasn't saved: the cause under the actions, Continue stays)
 *   · success (n/a: the next step is the answer)
 */
import { Trans } from '@lingui/react/macro';
import { err, fromRpcError, ok, type Result, type TaalcutError } from '@taalcut/core';
import { Button, SkeletonLines } from '@taalcut/ui';
import { useState, type ReactNode } from 'react';
import { useBackend } from '../backend/backend';
import { agreeToBetaTerms } from '../features/terms/beta-terms';
import { useServices } from '../services/provider';
import { AlphaSetup, ALPHA_TERMS } from './setup/alpha-setup';
import { BetaSetup } from './setup/beta-setup';
import { FirstVideoSetup } from './setup/first-video/first-video-setup';
import { SourcesSetup } from './setup/sources/sources-setup';
import type { StepGate } from './step-gate';
import { STEP_ICONS } from './step-icons';
import { beforeTerms, type OnboardingStep } from './steps';
import { useOnboardingProgress, type useOnboardingStep } from './use-onboarding';

/** One step's way on and way out (use-onboarding.ts). */
export type StepFlow = ReturnType<typeof useOnboardingStep>;

/** Steps whose setup says when they're done start with Continue off (docs/onboarding.md section 2). */
const GATED: ReadonlySet<OnboardingStep> = new Set(['sources']);

/** Where a step's gate starts. */
export const initialGate = (step: OnboardingStep): StepGate => ({ ready: !GATED.has(step) });

/** What the step sets up, opened on the way chosen inside it last time. */
export function StepSetup({ step, flow }: { step: OnboardingStep; flow: StepFlow }) {
  const progress = useOnboardingProgress();
  const branch = progress.data?.branch;
  const setups: Record<OnboardingStep, () => ReactNode> = {
    alpha: () => <AlphaSetup />,
    beta: () => <BetaSetup />,
    sources: () => (
      <SourcesSetup resume={branch?.source} onChoose={flow.choose} onLater={() => void flow.continueOn()} />
    ),
    'first-video': () => <FirstVideoSetup onStart={flow.finish} branch={branch} onChoose={flow.choose} />,
  };
  // A resume waits for the saved branch, so the way chosen last time opens; a failed read only loses the resume.
  if (progress.status === 'loading') return <SkeletonLines lines={4} className="max-w-xl py-2" />;
  return setups[step]();
}

/** Saves that the person agreed to this step's terms (none on other steps). */
function useAgree(step: OnboardingStep): () => Promise<Result<unknown>> {
  const backend = useBackend();
  const { acknowledgements } = useServices();
  return async () => {
    if (step === 'beta') return agreeToBetaTerms(backend);
    if (step !== 'alpha') return ok(undefined);
    // The UI kit's store throws when it can't save (storage off): the cause comes back as a value.
    return acknowledgements.record(ALPHA_TERMS).then(
      () => ok(undefined),
      (cause: unknown) => err(fromRpcError(cause)),
    );
  };
}

/** Continue: on a terms step, agreeing to its terms. */
export function ContinueButton({
  step,
  flow,
  gate,
  onProblem,
}: {
  step: OnboardingStep;
  flow: StepFlow;
  gate: StepGate;
  /** The agreement couldn't be saved (null: cleared on the next try). */
  onProblem: (error: TaalcutError | null) => void;
}) {
  const agreeToTerms = useAgree(step);
  const [agreeing, setAgreeing] = useState(false);
  const onContinue = async () => {
    onProblem(null);
    setAgreeing(true);
    // Continuing past a terms step is agreeing to its terms: only once that is saved.
    const agreed = await agreeToTerms();
    setAgreeing(false);
    if (!agreed.ok) return onProblem(agreed.error);
    await flow.continueOn();
  };
  const agree = step === 'alpha' || step === 'beta';
  // Before the terms, the next step depends on the build: Continue waits until it is known.
  const buildKnown = flow.build.ready || !beforeTerms(step);
  return (
    <Button
      data-action="continue"
      variant="primary"
      size="lg"
      icon={agree ? STEP_ICONS.agree : STEP_ICONS.next}
      iconPlacement={agree ? 'start' : 'end'}
      disabled={!gate.ready || !buildKnown}
      loading={agreeing || flow.leaving === 'continue'}
      onClick={() => void onContinue()}
    >
      {agree ? <Trans>Agree and continue</Trans> : <Trans>Continue</Trans>}
    </Button>
  );
}
