// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: voice consent card (U-4, P3-B6) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · a decision card (CardFrame: raised, hairline, xl radius): recording your own voice with
 *   the consent line, started only by you. Its status chip says the step in a word (teal while you record, green
 *   once saved or made, warning on a mismatch, danger when it failed); the steps are media/consent-*.tsx
 * states: ready · recording · checking · mismatch · stored · cloned · failed · withdrawn (here only); each control's
 *   default, hover, focus-visible, active, disabled, loading, error and success are its Button's or Input's
 * motion: none of its own (the level meter's bars) · pre-emit critique: P5 H4 E4 S4 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { CardOf } from '@taalcut/core';
import { CircleAlert } from 'lucide-react';
import { Chip } from '#components/badge';
import {
  ConsentChecking,
  ConsentCloned,
  ConsentFailed,
  ConsentMismatch,
  ConsentStored,
  ConsentWithdrawn,
} from '../media/consent-outcomes';
import { ConsentReady, ConsentRecordingStep } from '../media/consent-record-steps';
import { mediaErrorMessage } from '../media/media-errors';
import { useConsentRecording, type ConsentStatus } from '../media/use-consent-recording';
import { CardFrame } from './card-frame';

const TONE = {
  ready: 'neutral',
  recording: 'you',
  checking: 'neutral',
  mismatch: 'warning',
  stored: 'success',
  cloned: 'success',
  failed: 'danger',
  withdrawn: 'neutral',
} as const satisfies Record<ConsentStatus, string>;

/** U-4: recording your own voice for a clone, with the consent line heard on this Mac first. */
export function VoiceConsentCard({ card }: { card: CardOf<'voiceConsent'> }) {
  const { t, i18n } = useLingui();
  const consent = useConsentRecording(card);
  const label: Record<ConsentStatus, string> = {
    ready: t`Ready to record`,
    recording: t`Recording`,
    checking: t`Checking`,
    mismatch: t`Didn’t match`,
    stored: t`Consent saved`,
    cloned: t`Voice made`,
    failed: t`Didn’t work`,
    withdrawn: t`Withdrawn`,
  };
  const error = consent.error ? (
    <p role="alert" className="m-0 flex items-start gap-2 text-sm text-danger-strong">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{mediaErrorMessage(i18n, consent.error)}</span>
    </p>
  ) : null;
  const step = { consent, termsVersion: card.termsVersion, language: card.language, error };

  return (
    <CardFrame
      cardType="voiceConsent"
      data-status={consent.status}
      title={t`Your own voice`}
      aside={
        <Chip tone={TONE[consent.status]} data-slot="consent-status">
          {consent.status === 'recording' ? (
            <span aria-hidden className="size-1.5 rounded-pill bg-you-strong" />
          ) : null}
          {label[consent.status]}
        </Chip>
      }
    >
      {consent.status === 'ready' ? <ConsentReady {...step} /> : null}
      {consent.status === 'recording' ? <ConsentRecordingStep {...step} /> : null}
      {consent.status === 'checking' ? <ConsentChecking /> : null}
      {consent.status === 'mismatch' ? <ConsentMismatch {...step} /> : null}
      {consent.status === 'stored' ? <ConsentStored consent={consent} error={error} /> : null}
      {consent.status === 'cloned' ? <ConsentCloned consent={consent} error={error} /> : null}
      {consent.status === 'failed' ? <ConsentFailed consent={consent} error={error} /> : null}
      {consent.status === 'withdrawn' ? <ConsentWithdrawn /> : null}
    </CardFrame>
  );
}
