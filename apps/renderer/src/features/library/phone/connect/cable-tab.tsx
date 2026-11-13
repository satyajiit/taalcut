// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H4 E4 S5 R5 V4
 * Hallmark · page: Cable (/library/phone/cable) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the Wi-Fi tab's beats, for the cable: plug in, allow it on the phone, choose what to
 *   bring in. The current beat holds first run's cable flow as it is (found, the phone's own prompts in words, the
 *   picker, the run), so it is said once, where you are; the others say what that beat will ask. Then the standing
 *   notes on a hairline. Nothing listens on the network for it (the band says so, with the way to Wi-Fi).
 * states: waiting for a phone (beat 1) · found or a prompt on the phone (beat 2, the flow's words) · ready (beat 3,
 *   the picker) · importing (beat 3, the run) · finished (all done, Pick more, secondary) · the phone list failed
 *   (the cause, Try again when it can help, and the way to Wi-Fi) · the flow's own errors (its ErrorLine) · not on
 *   this system yet (UX3-MAC: off a Mac the desktop builds no USB bridge; one line says so, with the way to Wi-Fi)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { DeviceRun } from '@taalcut/core';
import { Button, ErrorLine, usePlatformChoice, usePlatformFeatures } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { Aperture, CirclePause } from 'lucide-react';
import { useState } from 'react';
import { useBackend } from '../../../../backend/backend';
import { useRpcStream } from '../../../../backend/use-rpc';
import { CableSource } from '../../../../onboarding/setup/sources/cable-source';
import { INLINE_LINK, PHONE_TAB_PATHS } from '../flow/phone-tabs';
import type { StepState } from '../session/connection';
import { usePhoneFlow } from '../session/phone-flow';
import { Step } from './steps';

const FINISHED: ReadonlySet<DeviceRun['state']> = new Set(['succeeded', 'failed', 'cancelled']);

type Beats = readonly [StepState, StepState, StepState];

/** Where the cable is: no phone, a phone to open or allow, a phone ready to pick from, a run going or done. */
function beatsOf(found: boolean, ready: boolean, running: boolean, finished: boolean): Beats {
  if (running) return ['done', 'done', finished ? 'done' : 'current'];
  if (ready) return ['done', 'done', 'current'];
  if (found) return ['done', 'current', 'next'];
  return ['current', 'next', 'next'];
}

function CableNotes() {
  const { t } = useLingui();
  return (
    <div className="flex flex-col gap-2 border-t border-rule-subtle pt-5">
      <p className="m-0 flex max-w-prose items-start gap-2 type-body text-ink-2">
        <Aperture aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t`Live Photos keep their motion over a cable. Sent over Wi-Fi from the phone’s browser, they arrive as stills.`}
      </p>
      <p className="m-0 flex max-w-prose items-start gap-2 type-body text-ink-2">
        <CirclePause aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t`Leaving this page doesn’t stop an import. Unplugging pauses it, and plugging back in carries on.`}
      </p>
    </div>
  );
}

/** Off a Mac the cable isn't here yet (platform-features.ts): what to do instead, never a wait for a phone. */
function CableNotYet() {
  const choose = usePlatformChoice();
  return (
    <div data-slot="cable-way" data-state="unavailable" className="flex flex-col gap-2">
      <p className="m-0 type-card-title text-ink">
        {choose({
          mac: null,
          computer: <Trans>Bringing clips in with a cable isn’t on Linux yet</Trans>,
          windows: <Trans>Bringing clips in with a cable isn’t on Windows yet</Trans>,
        })}
      </p>
      <p className="m-0 max-w-prose type-body text-ink-2">
        <Trans>
          Send them{' '}
          <Link to={PHONE_TAB_PATHS.wifi} replace className={INLINE_LINK}>
            over Wi-Fi
          </Link>{' '}
          instead. The phone needs no app, only its browser.
        </Trans>
      </p>
    </div>
  );
}

export function CableTab() {
  return usePlatformFeatures().cableImport ? <CableWay /> : <CableNotYet />;
}

function CableWay() {
  const { t } = useLingui();
  const backend = useBackend();
  const { cableRun, setCableRun } = usePhoneFlow();
  const [finished, setFinished] = useState(false);
  // A new round reopens the phone list (and the flow's own, which it remounts) after it failed.
  const [round, setRound] = useState(0);
  const devices = useRpcStream((signal) => backend.transfer.devices(undefined, { signal }), [backend, round]);
  const device = devices.data?.devices.find((each) => each.connected);
  const [plug, allow, pick] = beatsOf(
    device !== undefined,
    device?.access === 'ready',
    cableRun !== null,
    finished,
  );
  const flow = (
    <CableSource
      key={round}
      runId={cableRun}
      onStarted={(runId) => {
        setFinished(false);
        setCableRun(runId);
      }}
      onRun={(run) => setFinished(FINISHED.has(run.state))}
    />
  );

  return (
    <div data-slot="cable-way" className="flex flex-col gap-8">
      <ol className="m-0 flex list-none flex-col gap-5 p-0">
        <Step n={1} state={plug} title={t`Plug your phone into this Mac`}>
          <p className="m-0 max-w-prose type-body text-ink-2">
            {t`Taalcut looks for a phone on a cable only while this tab is open.`}
          </p>
          {devices.status === 'error' ? (
            <div data-slot="cable-error" className="flex flex-col items-start gap-2">
              <ErrorLine error={devices.error} onRetry={() => setRound((was) => was + 1)} />
              <p className="m-0 type-body text-ink-2">
                <Trans>
                  You can still send clips{' '}
                  <Link to={PHONE_TAB_PATHS.wifi} replace className={INLINE_LINK}>
                    over Wi-Fi
                  </Link>
                  .
                </Trans>
              </p>
            </div>
          ) : null}
        </Step>
        <Step n={2} state={allow} title={t`Allow it on the phone`}>
          {allow === 'current' ? (
            flow
          ) : (
            <p className="m-0 max-w-prose type-body text-ink-2">
              {t`An iPhone asks you to unlock it and tap Trust. An Android phone asks what the cable is for: choose File transfer.`}
            </p>
          )}
        </Step>
        <Step n={3} state={pick} last title={t`Choose what to bring in`}>
          {pick === 'next' ? (
            <p className="m-0 max-w-prose type-body text-ink-2">
              {t`The last 30 days of videos and Live Photos, only what’s new, or choose others.`}
            </p>
          ) : (
            flow
          )}
          {cableRun && finished ? (
            <div>
              <Button variant="secondary" onClick={() => setCableRun(null)}>
                {t`Pick more from the phone`}
              </Button>
            </div>
          ) : null}
        </Step>
      </ol>
      <CableNotes />
    </div>
  );
}
