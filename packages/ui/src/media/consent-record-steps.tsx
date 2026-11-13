// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: voice consent, ready and recording · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the first two steps inside the voice consent card (a decision card, so no frame here):
 *   ready says what happens in plain words, takes the name as you'll say it, shows the line and the passage, the
 *   microphone's state and Start; recording shows the level, the time against the minute the check needs, the
 *   words to read, Stop (after a minute) and Cancel
 * states: default · hover/active/focus-visible (Input, Button) · disabled (Start without a name, Stop before a
 *   minute: the reason in words beside it) · loading (Start while macOS asks, Stop while the file is finished) ·
 *   error (the cause under the buttons, role alert) · success (the next step replaces this one)
 * motion: the level and minute bars only (transform); reduced motion: no easing
 * pre-emit critique: P5 H4 E4 S4 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { Mic, Square } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Button } from '#components/button';
import { Input } from '#components/input';
import { useTimecode } from '../make/timecode';
import { ConsentScript } from './consent-script';
import { LevelMeter } from './level-meter';
import { CONSENT_RECORDING_MS, SPEAKER_NAME_MAX } from './media-commands';
import type { MicrophonePermission } from './media-actions';
import type { ConsentRecording } from './use-consent-recording';

const MS = { num: 1000, den: 1 } as const;

interface StepProps {
  consent: ConsentRecording;
  termsVersion: string;
  language: string;
  /** The error line, when there is one. */
  error: ReactNode;
}

export function ConsentReady({ consent, termsVersion, language, error }: StepProps) {
  const { t } = useLingui();
  const nameId = useId();
  const hintId = useId();
  const named = consent.speakerName.trim() !== '';
  return (
    <>
      {/* break-words: a word longer than the card (a pseudo-locale pad, a long name) breaks rather than overflows. */}
      <p className="m-0 text-base break-words text-ink">
        {t`Read the line below in your own voice, then keep reading for about a minute. Taalcut checks on this Mac that it’s you saying the line and keeps the recording here. Nothing leaves this Mac until you choose Create my voice.`}
      </p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={nameId} className="text-sm font-semibold text-ink">
          {t`Your name as you’ll say it`}
        </label>
        <Input
          id={nameId}
          value={consent.speakerName}
          maxLength={SPEAKER_NAME_MAX}
          autoComplete="name"
          aria-describedby={hintId}
          disabled={consent.busy === 'start'}
          onChange={(event) => consent.setSpeakerName(event.target.value)}
          className="max-w-sm"
        />
      </div>
      <ConsentScript termsVersion={termsVersion} language={language} speakerName={consent.speakerName} />
      <MicrophoneState permission={consent.permission} />
      {consent.canRecord ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            variant="primary"
            size="sm"
            disabled={!named}
            loading={consent.busy === 'start'}
            aria-describedby={hintId}
            onClick={() => void consent.start()}
          >
            <Mic aria-hidden />
            {t`Start recording`}
          </Button>
          <span id={hintId} className="text-xs text-ink-2">
            {named ? t`Recording starts at once. Stop works after a minute.` : t`Type your name first.`}
          </span>
        </div>
      ) : (
        <span id={hintId} className="sr-only">
          {t`Your name is part of the line you read.`}
        </span>
      )}
      {error}
    </>
  );
}

/** Where the microphone stands, in words; before Start, what will happen. */
function MicrophoneState({ permission }: { permission: MicrophonePermission | null }) {
  const { t } = useLingui();
  const words: Record<MicrophonePermission, string> = {
    granted: t`The microphone is on for Taalcut.`,
    denied: t`Taalcut can’t use the microphone. Turn it on in System Settings › Privacy & Security › Microphone, then start again.`,
    restricted: t`This Mac doesn’t let apps use the microphone (a profile or Screen Time limits it).`,
    'not-determined': t`Taalcut needs the microphone to record. Start again to be asked.`,
  };
  const blocked = permission === 'denied' || permission === 'restricted';
  return (
    <p
      role={blocked ? 'alert' : undefined}
      data-slot="microphone-state"
      data-permission={permission ?? 'unknown'}
      className={blocked ? 'm-0 text-sm text-warning-strong' : 'm-0 text-sm text-ink-2'}
    >
      {permission ? words[permission] : t`Taalcut asks macOS for the microphone when you start.`}
    </p>
  );
}

export function ConsentRecordingStep({ consent, termsVersion, language, error }: StepProps) {
  const { t } = useLingui();
  const time = useTimecode();
  const stopHint = useId();
  const minute = consent.elapsedMs / CONSENT_RECORDING_MS.min;
  const enough = minute >= 1;
  const elapsed = time.clock(consent.elapsedMs, MS);
  const needed = time.clock(CONSENT_RECORDING_MS.min, MS);
  return (
    <>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <LevelMeter subscribe={consent.subscribeLevel} minute={minute} className="min-w-40 flex-1" />
        <p className="m-0 text-sm text-ink tabular-nums" data-slot="elapsed">
          {t`${elapsed} of ${needed}`}
        </p>
      </div>
      <ConsentScript
        termsVersion={termsVersion}
        language={language}
        speakerName={consent.speakerName}
        reading
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {consent.canRecord ? (
          <>
            <Button
              variant="primary"
              size="sm"
              disabled={!enough || consent.busy === 'cancel'}
              loading={consent.busy === 'stop'}
              aria-describedby={stopHint}
              onClick={() => void consent.stop()}
            >
              <Square aria-hidden />
              {t`Stop and check`}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={consent.busy === 'cancel'}
              disabled={consent.busy === 'stop'}
              onClick={() => void consent.cancel()}
            >
              {t`Cancel recording`}
            </Button>
          </>
        ) : null}
        <span id={stopHint} role="status" className="text-xs text-ink-2">
          {enough
            ? t`That’s a minute. Finish the sentence you’re on, then stop.`
            : t`Keep reading. Stop works after a minute.`}
        </span>
      </div>
      {error}
    </>
  );
}
