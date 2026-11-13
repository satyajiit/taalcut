// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { Trans, useLingui } from '@lingui/react/macro';
import type { TaalcutError } from '@taalcut/core';
import { Button, ErrorLine } from '@taalcut/ui';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { FinishProvider, MakeFirstVideo, useFinishReason } from '../../onboarding/finish-gate';
import { StepGateProvider, type StepGate } from '../../onboarding/step-gate';
import { STEP_ICONS } from '../../onboarding/step-icons';
import { ContinueButton, initialGate, StepSetup } from '../../onboarding/step-parts';
import { BackLink, SkipButton, StepScreen } from '../../onboarding/step-screen';
import {
  beforeTerms,
  isTermsStep,
  linkedStep,
  parseStep,
  railSteps,
  type OnboardingStep,
} from '../../onboarding/steps';
import { useOnboardingStep } from '../../onboarding/use-onboarding';

export const Route = createFileRoute('/onboarding/$step')({
  params: {
    parse: ({ step }) => ({ step: parseStep(step) }),
    stringify: ({ step }) => ({ step }),
  },
  // An old step's address (the order before UX4) opens the step that now holds what it showed.
  beforeLoad: ({ params }) => {
    const step = linkedStep(params.step);
    if (step !== params.step) throw redirect({ to: '/onboarding/$step', params: { step }, replace: true });
  },
  component: OnboardingStepPage,
});

function OnboardingStepPage() {
  const { step } = Route.useParams();
  // A new screen per step: its time on screen starts when it opens.
  return <Step key={step} step={linkedStep(step)} />;
}

/** What stops Continue that isn't the step's own: the agreement not saved, or the build not read. */
function Problem({
  agreeing,
  build,
  onRetryBuild,
}: {
  agreeing: TaalcutError | null;
  build: TaalcutError | null;
  onRetryBuild: () => void;
}) {
  const { t } = useLingui();
  if (agreeing) return <ErrorLine error={agreeing} />;
  if (!build) return null;
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="m-0 type-body text-ink-2">
        {t`Taalcut couldn’t check which version this is, so it doesn’t know yet whether there are terms to agree to.`}
      </p>
      <ErrorLine error={build} />
      <Button size="sm" icon={STEP_ICONS.retry} onClick={onRetryBuild}>
        {t`Try again`}
      </Button>
    </div>
  );
}

/**
 * One step, wired (P2-X4, P3-B3, UX4): what it sets up, Back, the way on when it's done (saved as you go), and the
 * quiet way out. The last step's way on is the finish, Make my first video; its way out starts without one.
 */
function Step({ step }: { step: OnboardingStep }) {
  const flow = useOnboardingStep(step);
  const [gate, setGate] = useState<StepGate>(() => initialGate(step));
  const [agreeing, setAgreeing] = useState<TaalcutError | null>(null);
  const last = !flow.next;
  const buildError = beforeTerms(step) ? flow.build.error : null;
  const screen = (next: ReactNode, waiting: string | undefined) => (
    <StepScreen
      step={step}
      steps={railSteps(step, flow.steps)}
      stepsReady={flow.build.ready || flow.build.error !== null}
      back={<BackLink previous={flow.previous} onLeave={flow.leaveBack} />}
      next={next}
      out={
        <SkipButton
          label={last ? <Trans>Start without a video</Trans> : undefined}
          busy={flow.leaving === 'skip'}
          onSkip={() => void flow.skip()}
        />
      }
      waiting={waiting}
      note={
        isTermsStep(step) ? (
          <Trans>
            Skip for now finishes setup without agreeing to these terms. You can run setup again from Settings
            › About.
          </Trans>
        ) : undefined
      }
      problem={<Problem agreeing={agreeing} build={buildError} onRetryBuild={flow.build.reload} />}
    >
      <StepSetup step={step} flow={flow} />
    </StepScreen>
  );
  return (
    <StepGateProvider value={setGate}>
      {last ? (
        <FinishProvider>
          <FinishScreen render={screen} />
        </FinishProvider>
      ) : (
        screen(
          <ContinueButton step={step} flow={flow} gate={gate} onProblem={setAgreeing} />,
          gate.ready ? undefined : gate.reason,
        )
      )}
    </StepGateProvider>
  );
}

/** The last step's screen: its primary is the finish, and the finish's reason sits under the actions. */
function FinishScreen({ render }: { render: (next: ReactNode, waiting: string | undefined) => ReactNode }) {
  const reason = useFinishReason();
  return <>{render(<MakeFirstVideo />, reason)}</>;
}
