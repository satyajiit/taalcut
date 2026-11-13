// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: onboarding step screen (UX4) · genre: atmospheric studio app (brand moment, quiet) · system: DESIGN.md
 *   v0.6 + _orch/ux4/specs/design-onb.md
 * layout: the onboarding frame (onboarding-frame.tsx): a sidebar that stands still, with the logo, the steps as a rail
 *   of beats (step-rail.tsx) and Getting ready; beside it the step's heading (type-headline), one line (type-prose),
 *   the step's Kaatu moment (the one Kaatu on the screen, beside where you read, never parked in a corner), then its
 *   own setup, the one part that scrolls; under that its actions, standing still on a hairline: Back, the way on,
 *   and the quiet way out at the row's end. Top-aligned, left-aligned: no centred card, no icon tile.
 * motion: a step reached from another arrives (8 px rise and fade, --dur-short, ease-out) while the rail's beat
 *   glides to it; the screen a window opens on is simply there. Reduced motion: a 150 ms fade, the beat at once.
 * states: the actions are Buttons with the registry's glyphs (eight states: Back is a link styled secondary;
 *   Continue and Skip spin while progress is saved; Continue is off with its reason under it) · error (an ErrorLine
 *   under the actions: terms not saved, the build not read) · a terms step says what skipping means
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { Arrival, Button, Logo, cn, useHostPlatform } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useId, type ReactNode } from 'react';
import { GettingReady } from '../features/downloads/getting-ready';
import { useDocumentTitle } from '../shell/page';
import { OnboardingFrame } from './onboarding-frame';
import { useQuietStart } from './quiet-start';
import { STEP_ICONS } from './step-icons';
import { useCameFrom } from './step-memory';
import { StepRail } from './step-rail';
import { stepCopy, type OnboardingStep } from './steps';

/** The way out of first run, on every screen: progress is kept, first run doesn't open again at launch. */
export function SkipButton({
  label,
  onSkip,
  busy = false,
  disabled = false,
  flush = false,
  className,
}: {
  label?: ReactNode;
  onSkip: () => void;
  busy?: boolean;
  disabled?: boolean;
  /** First in its row: the text lines up with the column's edge, not the button's padding. */
  flush?: boolean;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      data-action="skip"
      loading={busy}
      disabled={disabled}
      onClick={onSkip}
      className={cn(flush && '-ml-4', className)}
    >
      {label ?? <Trans>Skip for now</Trans>}
    </Button>
  );
}

/** Back to the step before, or to the welcome from the first step: a link, so it reads as going somewhere. */
export function BackLink({
  previous,
  onLeave,
}: {
  previous: OnboardingStep | undefined;
  onLeave: () => void;
}) {
  const { t, i18n } = useLingui();
  const platform = useHostPlatform();
  const where = previous ? i18n._(stepCopy(previous, platform).name) : t`Welcome`;
  return (
    <Button asChild variant="secondary" size="lg" data-action="back" icon={STEP_ICONS.back}>
      {previous ? (
        <Link
          to="/onboarding/$step"
          params={{ step: previous }}
          aria-label={t`Back to ${where}`}
          onClick={onLeave}
        >
          <Trans>Back</Trans>
        </Link>
      ) : (
        <Link to="/onboarding" aria-label={t`Back to ${where}`} onClick={onLeave}>
          <Trans>Back</Trans>
        </Link>
      )}
    </Button>
  );
}

export interface StepScreenProps {
  step: OnboardingStep;
  /** The rail's steps (railSteps: the build's, with the open one). */
  steps: readonly OnboardingStep[];
  /** The build said which steps it has: until then the rail is bones. */
  stepsReady: boolean;
  /** What the step sets up, shown as it will be (its Kaatu moment first, in a StepMoment): the ways in, the reel… */
  children: ReactNode;
  /** Back: the link to the step before (BackLink). */
  back: ReactNode;
  /** The way forward: Continue, or on the last step Make my first video. */
  next: ReactNode;
  /** The quiet way out at the row's end: Skip for now, or on the last step Start without a video. */
  out?: ReactNode;
  /** Why the way on is off: one line under the actions. */
  waiting?: string | undefined;
  /** A line about the way out (a terms step: skipping doesn't agree to them). */
  note?: ReactNode;
  /** What went wrong moving on (an ErrorLine), under the actions. */
  problem?: ReactNode;
}

/**
 * A step's Kaatu moment, first in its setup, right under the heading: the step's one Kaatu, beside where you read
 * (a tip, a wait, a success, or what needs you). Its place holds still while its words change.
 */
export function StepMoment({ children }: { children: ReactNode }) {
  return (
    <div data-slot="step-moment" className="flex min-h-12 flex-col gap-3">
      {children}
    </div>
  );
}

/** One first-run step: where you are, what this step sets up, the way back, on and out. */
export function StepScreen({
  step,
  steps,
  stepsReady,
  children,
  back,
  next,
  out,
  waiting,
  note,
  problem,
}: StepScreenProps) {
  const { t, i18n } = useLingui();
  const platform = useHostPlatform();
  const copy = stepCopy(step, platform);
  const title = i18n._(copy.title);
  const heading = useId();
  const from = useCameFrom(step);
  useDocumentTitle(title);
  useQuietStart();
  return (
    <OnboardingFrame
      label={title}
      sidebar={
        <>
          <Logo label={t`Taalcut`} colourway="four-colour" />
          <StepRail current={step} steps={steps} ready={stepsReady} from={from} />
          <GettingReady />
        </>
      }
      footer={
        <div data-slot="step-actions" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {back}
            {next}
            {out ? <div className="ms-auto">{out}</div> : null}
          </div>
          {waiting ? (
            <p data-slot="step-waiting" className="m-0 type-body text-ink-2">
              {waiting}
            </p>
          ) : null}
          {note ? <p className="m-0 max-w-prose type-meta text-ink-2">{note}</p> : null}
          {problem}
        </div>
      }
    >
      <Arrival animate={from !== null}>
        <section aria-labelledby={heading} className="flex min-w-0 flex-col gap-8">
          <header className="flex flex-col gap-3">
            <h1 id={heading} className="m-0 type-headline text-balance text-ink">
              {title}
            </h1>
            <p className="m-0 max-w-prose type-prose text-pretty text-ink-2">{i18n._(copy.body)}</p>
          </header>
          <div data-slot="step-setup">{children}</div>
        </section>
      </Arrival>
    </OnboardingFrame>
  );
}
