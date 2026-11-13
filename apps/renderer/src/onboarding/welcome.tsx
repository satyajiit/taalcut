// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: onboarding welcome (UX4) · genre: atmospheric studio app (brand moment) · system: DESIGN.md v0.4 +
 *   _orch/ux4/specs/design-onb.md
 * layout: the four-colour lockup counts itself in, once, top left; the promise as the display headline and one plain
 *   sentence (type-prose); then Kaatu, the hero (88 px), with the way through first run in one line: your clips, then
 *   a reel to follow. Beside it, one still figure of a cut on the beat in the timeline's own marks, and three
 *   sentences that say what the marks mean (welcome-figure.tsx). No eyebrow, no tabs, no slides, no card. The
 *   actions stand still at the window's foot on a hairline, in the onboarding frame (Get started with the way-on
 *   arrow, Skip for now, the language line at the row's end), so a short window scrolls the words, never the way in.
 * motion: the logo count-in (design/logo/motion/README.md: the first onboarding screen, once; reduced motion: a
 *   150 ms fade), then Kaatu waves once as it lands; Kaatu's own breath after that. Everything else is there when the
 *   page opens.
 * states: n/a (layout); Get started and Skip for now are Buttons (eight states; Skip spins while first run is saved
 *   as finished and fails into an ErrorLine under them); the language line has its own (welcome-language.tsx)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { ONBOARDING_COMMANDS, type TaalcutError } from '@taalcut/core';
import { Button, ErrorLine, Kaatu, useHostPlatform, useIdleMood } from '@taalcut/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useCommand } from '../backend/use-command';
import { useDocumentTitle } from '../shell/page';
import { CountInLockup } from './count-in-lockup';
import { writeLaunchHint } from './launch-hint';
import { OnboardingFrame } from './onboarding-frame';
import { markStarted } from './started-at';
import { STEP_ICONS } from './step-icons';
import { useCameFrom } from './step-memory';
import { SkipButton } from './step-screen';
import { WelcomeFigure } from './welcome-figure';
import { WelcomeLanguage } from './welcome-language';

/** Kaatu waves once the count-in has landed (its last beat and the wordmark take about two seconds). */
const WAVE_AFTER_MS = 2200;

/** Kaatu and the way through first run, in one line. */
function WelcomeKaatu() {
  const mood = useIdleMood();
  const [wave, setWave] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => setWave(1), WAVE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div data-slot="welcome-kaatu" className="flex items-center gap-4">
      <Kaatu spot="hero" mood={mood} {...(wave ? { perform: 'wave' as const, performKey: wave } : {})} />
      <p className="m-0 max-w-[34ch] type-prose text-pretty text-ink-2">
        <Trans>First, show Taalcut where your clips are. Then pick a reel for it to follow.</Trans>
      </p>
    </div>
  );
}

/** First run, first screen: the brand moment. The lockup counts itself in, once. */
export function Welcome() {
  const { t } = useLingui();
  const mac = useHostPlatform() === 'mac';
  const title = t`Cut your clips to the beat of a reel you love.`;
  useDocumentTitle(title);
  useCameFrom('welcome');
  const navigate = useNavigate();
  const command = useCommand({ toast: false });
  const [failed, setFailed] = useState<TaalcutError | null>(null);

  // Skipping from here: first run is done, and stays at /onboarding for later (Settings › About › Run setup again).
  const skip = async () => {
    setFailed(null);
    const saved = await command.run({
      name: ONBOARDING_COMMANDS.setProgress,
      payload: { step: 'sources', completed: true, via: 'skipped' },
    });
    if (!saved.ok) return setFailed(saved.error);
    writeLaunchHint('app');
    await navigate({ to: '/chat' });
  };

  return (
    <OnboardingFrame
      label={title}
      width="welcome"
      centred
      footer={
        <div
          data-slot="welcome-actions"
          className="flex flex-wrap items-start justify-between gap-x-10 gap-y-4"
        >
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                asChild
                variant="primary"
                size="lg"
                data-action="get-started"
                icon={STEP_ICONS.next}
                iconPlacement="end"
              >
                <Link to="/onboarding/$step" params={{ step: 'sources' }} onClick={() => markStarted()}>
                  <Trans>Get started</Trans>
                </Link>
              </Button>
              <SkipButton busy={command.pending} onSkip={() => void skip()} />
            </div>
            {failed ? <ErrorLine error={failed} /> : null}
          </div>
          <WelcomeLanguage />
        </div>
      }
    >
      <section data-slot="onboarding-welcome" className="@container w-full">
        <div className="grid items-center gap-x-16 gap-y-12 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <div className="flex min-w-0 flex-col items-start gap-8">
            <CountInLockup label={t`Taalcut`} className="h-24" />
            <div className="flex flex-col gap-4">
              <h1 className="m-0 max-w-[15ch] type-display text-balance [overflow-wrap:anywhere]">{title}</h1>
              <p className="m-0 max-w-prose type-prose text-pretty text-ink-2">
                {mac ? (
                  <Trans>
                    Taalcut turns your own footage into short videos that follow the timing of a reel you
                    like. Every video is made on this Mac.
                  </Trans>
                ) : (
                  <Trans>
                    Taalcut turns your own footage into short videos that follow the timing of a reel you
                    like. Every video is made on this computer.
                  </Trans>
                )}
              </p>
            </div>
            <WelcomeKaatu />
          </div>
          <WelcomeFigure />
        </div>
      </section>
    </OnboardingFrame>
  );
}
