// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: memory proposal card (LRN1-MEM) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 (A3) · a decision card: hairline frame, no icon, no edge · "Remember this?", then the
 *   agent's words as written (UserContent: never translated) with the violet Agent badge (who proposed it), where it
 *   would apply (every video, or the project or template by its own name), and what remembering does. Remember and
 *   Not now answer it like an approval card; Remember is marigold only while this card holds the transcript's one
 *   primary. Once remembered, a quiet link opens Settings → Memory, where it can be changed or deleted
 * states: pending (the two buttons; the chip waits until the card settles) · loading (the chosen button spins, the
 *   other waits) · error (a failed answer stays on the card: its cause and Try again) · approved · remembered
 *   (success chip, the link) · declined · expired (neutral chips, "Nothing was stored.") · each button carries the
 *   eight states (Button)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { CardOf } from '@taalcut/core';
import { Chip } from '../components/badge';
import { Button } from '../components/button';
import { useCardActions, type ApprovalDecision } from '../cards/card-actions';
import { CardFrame, UserContent } from '../cards/card-frame';
import { useInTranscript, usePrimaryVariant } from '../cards/primary-holder';
import { AnswerFailureLine, useAnswer } from '../cards/use-answer';
import { MemorySourceBadge } from './memory-source-badge';

type Card = CardOf<'memoryProposal'>;
type Status = Card['status'];

const STATUS_TONE = {
  pending: 'warning',
  approved: 'success',
  remembered: 'success',
  declined: 'neutral',
  expired: 'neutral',
} as const satisfies Record<Status, string>;

/** Remember and Not now while the card asks; the answer is a command (decide). */
function ProposalAnswers({ card }: { card: Card }) {
  const { t } = useLingui();
  const answer = useAnswer<ApprovalDecision>(card.status === 'pending');
  const primary = usePrimaryVariant(card.id);
  if (card.status !== 'pending' || !answer.canAnswer) return null;
  const send = (decision: ApprovalDecision) => void answer.send(decision, card.approvalId, decision);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          variant={primary}
          size="sm"
          loading={answer.pending === 'approve'}
          disabled={answer.pending === 'deny'}
          onClick={() => send('approve')}
        >
          {t`Remember`}
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

/** Where the item would apply: every video, or the project or template by its own name. */
function Where({ card }: { card: Card }) {
  const name = card.scopeName;
  if (card.scope.kind === 'user') return <Trans>Applies to every video.</Trans>;
  if (card.scope.kind === 'project')
    return name === null ? (
      <Trans>Applies to this project.</Trans>
    ) : (
      <Trans>
        Applies to the project{' '}
        <UserContent translate="no" className="font-medium text-ink">
          {name}
        </UserContent>
        .
      </Trans>
    );
  return name === null ? (
    <Trans>Applies to one template.</Trans>
  ) : (
    <Trans>
      Applies to the template{' '}
      <UserContent translate="no" className="font-medium text-ink">
        {name}
      </UserContent>
      .
    </Trans>
  );
}

/** "See it in Settings": Settings → Memory, where the remembered item can be changed or deleted. */
function SettingsLink() {
  const { navigate } = useCardActions();
  if (!navigate) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      className="-ms-3 self-start"
      onClick={() => navigate({ to: 'settings', section: 'memory' })}
    >
      <Trans>See it in Settings → Memory</Trans>
    </Button>
  );
}

/**
 * The agent proposes something to remember (PRD 7.2): asked at every autonomy level, because it steers every later
 * chat. Two buttons; the answer is a command, and nothing is stored unless the creator says Remember.
 */
export function MemoryProposalCard({ card }: { card: Card }) {
  const { t } = useLingui();
  const quiet = useInTranscript() && card.status === 'pending';
  // Declined or expired: nothing is stored, so nothing will steer a later chat.
  const settled = card.status === 'declined' || card.status === 'expired';
  const statusLabel: Record<Status, string> = {
    pending: t`Waiting for you`,
    approved: t`Approved`,
    remembered: t`Remembered`,
    declined: t`Not remembered`,
    expired: t`Expired`,
  };
  return (
    <CardFrame
      cardType="memoryProposal"
      data-status={card.status}
      title={t`Remember this?`}
      aside={quiet ? null : <Chip tone={STATUS_TONE[card.status]}>{statusLabel[card.status]}</Chip>}
    >
      <div className="flex flex-col items-start gap-1.5">
        <MemorySourceBadge source="agent" />
        <p className="m-0 type-body [overflow-wrap:anywhere]">
          <UserContent>{card.text}</UserContent>
        </p>
      </div>
      <p className="m-0 type-meta text-ink-2 [overflow-wrap:anywhere]">
        {settled ? (
          <Trans>Nothing was stored.</Trans>
        ) : (
          <>
            <Where card={card} />{' '}
            <Trans>Taalcut uses it in your later chats, and you can change or delete it in Settings.</Trans>
          </>
        )}
      </p>
      <ProposalAnswers card={card} />
      {card.status === 'remembered' ? <SettingsLink /> : null}
    </CardFrame>
  );
}
