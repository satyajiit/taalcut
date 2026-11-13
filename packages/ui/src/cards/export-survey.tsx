// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: export survey ("Would you post this?") · genre: atmospheric studio app · system: DESIGN.md v0.3
 * one question under a finished export, three small answers, asked once per render and only with telemetry on;
 *   not a card: a line on the canvas, the render card's foot
 * states: default · hover/focus/active (the Buttons') · disabled (an answer on its way) · loading (the pressed
 *   answer) · error (it couldn't be recorded: one line, nothing else breaks) · success ("Thanks." then nothing:
 *   the question is never asked again for this export) */

import { useLingui } from '@lingui/react/macro';
import type { RenderId } from '@taalcut/core';
import { useId, useState } from 'react';
import { Button } from '#components/button';
import { useCardActions, type SurveyAnswer } from './card-actions';

const ANSWERS: readonly SurveyAnswer[] = ['yes', 'maybe', 'no'];

/** The post-export question (P2-X7): telemetry's `export.survey`. Nothing shows without telemetry. */
export function ExportSurvey({ renderId }: { renderId: RenderId }) {
  const { t } = useLingui();
  const { survey } = useCardActions();
  const question = useId();
  const [state, setState] = useState<'asking' | SurveyAnswer | 'thanks' | 'failed'>('asking');
  // Asked once per export: an export answered before (here or in another window) doesn't ask again.
  if (!survey || (state === 'asking' && survey.asked(renderId))) return null;

  const words: Record<SurveyAnswer, string> = { yes: t`Yes`, maybe: t`Maybe`, no: t`No` };
  const answer = async (value: SurveyAnswer) => {
    setState(value);
    const result = await survey.answer(renderId, value);
    setState(result.ok ? 'thanks' : 'failed');
  };

  if (state === 'thanks') {
    return (
      <p role="status" data-slot="export-survey" className="m-0 text-sm text-ink-2">
        {t`Thanks. That helps.`}
      </p>
    );
  }
  return (
    <div
      data-slot="export-survey"
      role="group"
      aria-labelledby={question}
      className="flex flex-wrap items-center gap-x-3 gap-y-2"
    >
      <p id={question} className="m-0 text-sm font-medium text-ink">
        {t`Would you post this?`}
      </p>
      <div className="flex gap-1">
        {ANSWERS.map((value) => (
          <Button
            key={value}
            size="sm"
            variant="ghost"
            loading={state === value}
            disabled={state !== 'asking' && state !== 'failed' && state !== value}
            onClick={() => void answer(value)}
          >
            {words[value]}
          </Button>
        ))}
      </div>
      {state === 'failed' ? (
        <p role="alert" className="m-0 w-full text-sm text-danger-strong">
          {t`Couldn’t save your answer. It’s fine to skip it.`}
        </p>
      ) : null}
    </div>
  );
}
