// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: approval-card · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 (A3) · a decision card: hairline frame, no icon, no edge · its buttons
 * carry default · hover · focus · active · disabled · loading · error · success (Button)
 * P3-V4: an external agent's ask names it and links to what it may do (approval-requester.tsx)
 * UX round 1: a failed answer stays on the card (its cause and Try again); Go ahead is marigold only while this card
 *   holds the transcript's one primary; the chip shows only once it has settled (the waiting line says "waiting")
 * pre-emit critique: P5 H4 E4 S4 R5 V4 */

import { useLingui } from '@lingui/react/macro';
import type { CardOf } from '@taalcut/core';
import { Chip } from '#components/badge';
import { Button } from '#components/button';
import type { ApprovalDecision } from './card-actions';
import { ApprovalRequester, RequesterSettingsLink } from './approval-requester';
import { CardFrame, UserContent } from './card-frame';
import { toolLabel } from './labels';
import { useInTranscript, usePrimaryVariant } from './primary-holder';
import { AnswerFailureLine, useAnswer } from './use-answer';

type Status = CardOf<'approval'>['status'];
type SideEffect = CardOf<'approval'>['sideEffect'];

const STATUS_TONE = {
  pending: 'warning',
  approved: 'success',
  denied: 'neutral',
  expired: 'neutral',
} as const;

/** Go ahead and Not now while the ask is pending; the answer is a command (decide). */
function ApprovalAnswers({ card }: { card: CardOf<'approval'> }) {
  const { t } = useLingui();
  const answer = useAnswer<ApprovalDecision>(card.status === 'pending');
  const primary = usePrimaryVariant(card.id);
  if (card.status !== 'pending' || !answer.canAnswer) return null;
  const send = (decision: ApprovalDecision) => void answer.send(decision, card.approvalId, decision);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          variant={card.sideEffect === 'destructive' ? 'destructive' : primary}
          size="sm"
          loading={answer.pending === 'approve'}
          disabled={answer.pending === 'deny'}
          onClick={() => send('approve')}
        >
          {t`Go ahead`}
        </Button>
        <Button
          size="sm"
          loading={answer.pending === 'deny'}
          disabled={answer.pending === 'approve'}
          onClick={() => send('deny')}
        >
          {t`Not now`}
        </Button>
      </div>
      <AnswerFailureLine failure={answer.failure} />
    </>
  );
}

/**
 * The agent asks before it does something that changes or deletes your work,
 * or leaves the machine (PRD 7.1, approvals). Two buttons; the answer is a command.
 */
export function ApprovalCard({ card }: { card: CardOf<'approval'> }) {
  const { t, i18n } = useLingui();
  const requester = card.requester;
  const quiet = useInTranscript() && card.status === 'pending';

  const statusLabel: Record<Status, string> = {
    pending: t`Waiting for you`,
    approved: t`Approved`,
    denied: t`Declined`,
    expired: t`Expired`,
  };
  const effectLabel: Record<SideEffect, string> = {
    write: t`Changes your project. You can undo it.`,
    destructive: t`Deletes something. This can't be undone.`,
    external: t`Sends data off this Mac.`,
  };

  return (
    <CardFrame
      cardType="approval"
      data-status={card.status}
      title={t`Can Taalcut go ahead?`}
      aside={quiet ? null : <Chip tone={STATUS_TONE[card.status]}>{statusLabel[card.status]}</Chip>}
    >
      {requester ? <ApprovalRequester requester={requester} /> : null}
      <p className="m-0 text-base">
        <UserContent>{card.summary}</UserContent>
      </p>
      {card.details ? (
        <p className="m-0 text-sm text-ink-2">
          <UserContent>{card.details}</UserContent>
        </p>
      ) : null}
      <p className="m-0 text-sm text-ink-2">
        {toolLabel(i18n, card.tool)} · {effectLabel[card.sideEffect]}
      </p>
      <ApprovalAnswers card={card} />
      {requester ? <RequesterSettingsLink requester={requester} /> : null}
    </CardFrame>
  );
}
