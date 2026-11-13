// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: consent-card · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 (A3) · a decision card: hairline frame, no icon, no edge · its buttons
 * carry default · hover · focus · active · disabled · loading · error · success (Button) · an external agent's
 * ask (round P3-3) names it above the files and links to what it may do, as the approval card does
 * UX round 1: the step in words ("Describing IMG_0418.MOV sends one frame of it to Google."), the cost on the same
 *   line as what leaves; a failed answer stays on the card with Try again; Allow once is marigold only while this card
 *   holds the transcript's one primary; no "Waiting for you" chip in a transcript (the waiting line says it)
 * pre-emit critique: P5 H5 E4 S5 R5 V4 */

import { Trans, useLingui } from '@lingui/react/macro';
import type { CardOf } from '@taalcut/core';
import { useState } from 'react';
import { Chip } from '#components/badge';
import { Button } from '#components/button';
import { useFormatters } from '#lib/format';
import { ApprovalRequester, RequesterSettingsLink } from './approval-requester';
import { CardFrame, UserContent } from './card-frame';
import { ConsentSentence, fileName } from './consent-words';
import { useInTranscript, usePrimaryVariant } from './primary-holder';
import { AnswerFailureLine, useAnswer } from './use-answer';

type Option = CardOf<'consent'>['options'][number];
type Status = CardOf<'consent'>['status'];

const STATUS_TONE = {
  pending: 'warning',
  approved: 'success',
  denied: 'neutral',
  expired: 'neutral',
} as const;

/**
 * Before your media leaves this Mac (PRD G9): which files go to which
 * provider, and what it costs. Allow once, Always allow (for these modules),
 * or Don't send. The answer is an approval with `remember` for Always allow.
 * EAR1-R3: a step that asks every time has no Always allow, and the card says so.
 */
export function ConsentCard({ card }: { card: CardOf<'consent'> }) {
  const { t } = useLingui();
  const format = useFormatters();
  const answer = useAnswer<Option>(card.status === 'pending');
  const primary = usePrimaryVariant(card.id);
  const quiet = useInTranscript() && card.status === 'pending';
  // "Always allow" changes what happens next time, which nothing else shows: the card says it.
  const [remembered, setRemembered] = useState(false);

  const statusLabel: Record<Status, string> = {
    pending: t`Waiting for you`,
    approved: t`Sent`,
    denied: t`Not sent`,
    expired: t`Expired`,
  };
  const optionLabel: Record<Option, string> = {
    'allow-once': t`Allow once`,
    'always-allow': t`Always allow`,
    deny: t`Don't send`,
  };

  const choose = async (option: Option) => {
    const remember = option === 'always-allow';
    const outcome = await answer.send(option, card.approvalId, option === 'deny' ? 'deny' : 'approve', {
      remember,
    });
    if (outcome === 'answered' && remember) setRemembered(true);
  };

  const requester = card.requester;
  const files = card.upload.files;
  const asksEveryTime = !card.options.includes('always-allow');
  const cost = card.estimate?.money ? format.money(card.estimate.money) : null;
  return (
    <CardFrame
      cardType="consent"
      data-status={card.status}
      title={t`Send this off your Mac?`}
      aside={quiet ? null : <Chip tone={STATUS_TONE[card.status]}>{statusLabel[card.status]}</Chip>}
    >
      {requester ? <ApprovalRequester requester={requester} /> : null}
      <p className="m-0 max-w-[60ch] text-md text-ink">
        <ConsentSentence card={card} />
      </p>
      {files.length > 1 ? (
        <ul className="m-0 list-disc ps-5 text-sm marker:text-ink-3">
          {files.map((file, index) => {
            const source = card.upload.sources?.[index];
            return (
              <li key={file} className="ps-0.5" data-upload-source={source}>
                <UserContent>{fileName(file)}</UserContent>
                {source === 'reference' ? (
                  <span className="ms-2 text-xs text-ink-3">{t`(reference)`}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {cost ? (
        <p className="m-0 text-sm text-ink-2">
          <Trans>
            It costs about <span className="font-medium text-ink tabular-nums">{cost}</span>.
          </Trans>
        </p>
      ) : null}
      {remembered && card.status === 'approved' ? (
        <p className="m-0 text-sm text-ink-2">{t`Taalcut won’t ask again before sending files for this.`}</p>
      ) : null}
      {asksEveryTime && card.status === 'pending' ? (
        <p className="m-0 text-sm text-ink-2">{t`Taalcut asks every time before sending this.`}</p>
      ) : null}
      {card.status === 'pending' && answer.canAnswer ? (
        <div className="flex flex-wrap gap-2">
          {card.options.map((option) => (
            <Button
              key={option}
              variant={option === 'allow-once' ? primary : 'secondary'}
              size="sm"
              loading={answer.pending === option}
              disabled={answer.pending !== null && answer.pending !== option}
              onClick={() => void choose(option)}
            >
              {optionLabel[option]}
            </Button>
          ))}
        </div>
      ) : null}
      <AnswerFailureLine failure={answer.failure} />
      {requester ? <RequesterSettingsLink requester={requester} /> : null}
    </CardFrame>
  );
}
