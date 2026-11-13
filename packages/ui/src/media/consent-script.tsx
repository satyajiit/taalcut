// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: consent script · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * what to read aloud for a voice consent: the consent line first, in the speaker's language with their name in it
 *   (counsel's words, never translated: lang set, translate="no"), then about a minute's passage in the app's
 *   language in a scroll box of its own
 * states: default · focus-visible (the scroll box takes focus so a keyboard can scroll it: base ring) · no line
 *   (terms this build doesn't know: the line is replaced by why) · not otherwise interactive
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { Trans, useLingui } from '@lingui/react/macro';
import { useId } from 'react';
import { cn } from '#lib/cn';
import { consentLine, consentLineLanguage } from './consent-lines';

export interface ConsentScriptProps {
  termsVersion: string;
  language: string;
  /** The name as the speaker will say it; empty shows a gap where it goes. */
  speakerName: string;
  /** Larger, for reading while recording. */
  reading?: boolean;
  className?: string;
}

export function ConsentScript({
  termsVersion,
  language,
  speakerName,
  reading = false,
  className,
}: ConsentScriptProps) {
  const { t } = useLingui();
  const passageId = useId();
  const line = consentLine(termsVersion, language, speakerName.trim() || '____');
  return (
    <div data-slot="consent-script" className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-ink-2">{t`First, say this line`}</span>
        {line ? (
          <p
            data-slot="consent-line"
            lang={consentLineLanguage(language)}
            translate="no"
            className={cn(
              'm-0 rounded-lg bg-panel px-3 py-2 font-medium break-words text-ink',
              reading ? 'text-lg leading-snug' : 'text-base',
            )}
          >
            {line}
          </p>
        ) : (
          <p className="m-0 text-sm text-danger-strong">
            {t`This consent is under terms this version of Taalcut doesn’t have. Update Taalcut to record it.`}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span id={passageId} className="text-xs font-semibold text-ink-2">
          {t`Then keep reading, at an easy pace, for about a minute`}
        </span>
        <div
          // A keyboard scrolls the passage too (axe: scrollable-region-focusable). A named group, not a landmark:
          // a page can show more than one consent card.
          tabIndex={0}
          role="group"
          aria-labelledby={passageId}
          className={cn(
            'max-h-44 overflow-y-auto rounded-lg border border-rule-subtle px-3 py-2 break-words text-ink-2',
            reading ? 'text-md leading-relaxed' : 'text-sm',
          )}
        >
          <p className="m-0">
            <Trans>
              I make short videos about the things I love. Some days that means a market at golden hour, the
              stalls opening one by one, the first coffee of the morning and the people who come back every
              week. Other days it is a trip, a recipe, or a friend learning something new.
            </Trans>
          </p>
          <p className="mt-2 mb-0">
            <Trans>
              When I film, I look for small moments: hands at work, steam rising from a cup, a smile that
              lasts a second longer than expected. Later I put them together, cut on the beat, and add a few
              words so people know where we are.
            </Trans>
          </p>
          <p className="mt-2 mb-0">
            <Trans>
              My voice is part of that. It tells the story in my own way, slowly when the picture needs room
              and quickly when the music lifts. Reading this at an easy pace lets Taalcut learn how I sound.
            </Trans>
          </p>
        </div>
      </div>
    </div>
  );
}
