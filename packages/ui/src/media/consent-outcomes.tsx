// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: voice consent, after recording · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the voice consent card's later steps (inside its frame): checking on this Mac, a
 *   mismatch (what was heard, untrusted, beside the line), consent saved with Create my voice (the upload question
 *   first: the recording leaves this Mac for ElevenLabs), the voice made with Withdraw (a destructive confirmation
 *   that names what it deletes), failed, withdrawn
 * states: default · hover/active/focus-visible (Button, Input) · disabled (Create without a name) · loading
 *   (checking: a spinner that keeps turning, slower under reduced motion; Create and Withdraw while they run) ·
 *   error (the cause, role alert) · success (saved, made, withdrawn: green mark and words)
 * pre-emit critique: P5 H4 E4 S4 R5 V4 */
import { Trans, useLingui } from '@lingui/react/macro';
import { CircleCheck, LoaderCircle } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Button } from '#components/button';
import { Input } from '#components/input';
import { UserContent } from '../cards/card-frame';
import { providerLabel } from '../cards/labels';
import { consentLine, consentLineLanguage } from './consent-lines';
import { VOICE_NAME_MAX } from './media-commands';
import type { ConsentRecording } from './use-consent-recording';

/** Who makes the voice: voice.createClone's provider (audio's default clone provider). */
const CLONE_PROVIDER = 'elevenlabs';

interface OutcomeProps {
  consent: ConsentRecording;
  error: ReactNode;
}

export function ConsentChecking() {
  const { t } = useLingui();
  return (
    <p role="status" className="m-0 flex items-center gap-2 text-base text-ink">
      <LoaderCircle
        aria-hidden
        className="size-4 shrink-0 animate-spin text-ink-2 motion-reduce:animate-[spin_2s_linear_infinite]"
      />
      {t`Checking it’s you saying the consent line… (on this Mac)`}
    </p>
  );
}

export function ConsentMismatch({
  consent,
  error,
  termsVersion,
  language,
}: OutcomeProps & { termsVersion: string; language: string }) {
  const { t } = useLingui();
  const expected = consentLine(termsVersion, language, consent.speakerName.trim() || '____');
  return (
    <>
      <p className="m-0 text-base text-ink">
        {t`That didn’t match the consent line. Say the whole line, with your name, before the passage.`}
      </p>
      <dl className="m-0 grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <dt className="text-xs font-semibold text-ink-2">{t`Taalcut heard`}</dt>
          <dd className="m-0 rounded-lg bg-panel px-3 py-2 text-sm text-ink">
            {consent.heard ? (
              <UserContent translate="no">{consent.heard}</UserContent>
            ) : (
              t`Nothing it could make out.`
            )}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs font-semibold text-ink-2">{t`The line to say`}</dt>
          <dd
            className="m-0 rounded-lg bg-panel px-3 py-2 text-sm text-ink"
            lang={consentLineLanguage(language)}
            translate="no"
          >
            {expected}
          </dd>
        </div>
      </dl>
      {consent.canRecord ? (
        <div>
          <Button variant="primary" size="sm" onClick={consent.recordAgain}>
            {t`Record again`}
          </Button>
        </div>
      ) : null}
      {error}
    </>
  );
}

export function ConsentStored({ consent, error }: OutcomeProps) {
  const { t, i18n } = useLingui();
  const [asking, setAsking] = useState(false);
  const [name, setName] = useState(consent.speakerName);
  const nameId = useId();
  const provider = providerLabel(i18n, CLONE_PROVIDER);
  return (
    <>
      <Done>{t`Consent saved on this Mac.`}</Done>
      {asking ? (
        <div data-slot="upload-question" className="flex flex-col gap-3 border-t border-rule-subtle pt-3">
          <p className="m-0 text-base font-semibold text-ink">{t`Send your recording off this Mac?`}</p>
          <p className="m-0 text-sm text-ink-2">
            <Trans>
              Creating your voice sends the consent recording to{' '}
              <UserContent translate="no">{provider}</UserContent>, which keeps your voice until you withdraw.
              Only this recording is sent.
            </Trans>
          </p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={nameId} className="text-sm font-semibold text-ink">
              {t`Name your voice`}
            </label>
            <Input
              id={nameId}
              value={name}
              maxLength={VOICE_NAME_MAX}
              onChange={(event) => setName(event.target.value)}
              className="max-w-sm"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={name.trim() === ''}
              loading={consent.busy === 'clone'}
              onClick={() => void consent.createVoice(name)}
            >
              {t`Send and create my voice`}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={consent.busy === 'clone'}
              onClick={() => setAsking(false)}
            >
              {t`Not now`}
            </Button>
          </div>
        </div>
      ) : consent.canDispatch ? (
        <div>
          <Button variant="primary" size="sm" onClick={() => setAsking(true)}>
            {t`Create my voice`}
          </Button>
        </div>
      ) : null}
      {error}
    </>
  );
}

export function ConsentCloned({ consent, error }: OutcomeProps) {
  const { t, i18n } = useLingui();
  const [confirming, setConfirming] = useState(false);
  const provider = providerLabel(i18n, CLONE_PROVIDER);
  const voiceName = consent.voiceName;
  return (
    <>
      <Done>
        {voiceName ? (
          <Trans>
            Your voice is ready: <UserContent translate="no">{voiceName}</UserContent>
          </Trans>
        ) : (
          t`Your voice is ready.`
        )}
      </Done>
      <p className="m-0 text-sm text-ink-2">{t`Taalcut can read voiceovers in it. You can withdraw your consent at any time, here or in Settings › Privacy.`}</p>
      {confirming ? (
        <div data-slot="withdraw-question" className="flex flex-col gap-3 border-t border-rule-subtle pt-3">
          <p className="m-0 text-sm text-ink">
            <Trans>
              Withdrawing deletes your recording and your consent from this Mac, and your voice at{' '}
              <UserContent translate="no">{provider}</UserContent>. You can’t undo it.
            </Trans>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              size="sm"
              loading={consent.busy === 'withdraw'}
              onClick={() => void consent.withdraw()}
            >
              {t`Withdraw and delete my voice`}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={consent.busy === 'withdraw'}
              onClick={() => setConfirming(false)}
            >
              {t`Keep my voice`}
            </Button>
          </div>
        </div>
      ) : consent.canDispatch ? (
        <div>
          <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
            {t`Withdraw consent`}
          </Button>
        </div>
      ) : null}
      {error}
    </>
  );
}

export function ConsentFailed({ consent, error }: OutcomeProps) {
  const { t } = useLingui();
  return (
    <>
      {error ?? <p className="m-0 text-base text-ink">{t`The recording didn’t work. Nothing was saved.`}</p>}
      {consent.canRecord ? (
        <div>
          <Button variant="primary" size="sm" onClick={consent.recordAgain}>
            {t`Record again`}
          </Button>
        </div>
      ) : null}
    </>
  );
}

export function ConsentWithdrawn() {
  const { t } = useLingui();
  return <Done>{t`Consent withdrawn. Your recording, your consent and your voice are deleted.`}</Done>;
}

function Done({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="m-0 flex items-start gap-2 text-base text-ink">
      <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success-strong" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
