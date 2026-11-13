// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: rateLimit card · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 (A3) · G8: a model limit met a run. Switched, resumed and stopped are one quiet line (not a
 *   card: nothing to decide, or a decision already made); waiting asks, so it is a decision card: hairline on raised,
 *   xl radius, no icon, no edge, no shadow, title 700, one marigold fill (Carry on at <time>, or Add credit when the
 *   key is out of credit)
 * states: default · hover/focus/active (Button, the menu's rows) · disabled (another answer in flight) · loading (the
 *   chosen action spins until the answer is in) · error (a failed answer: its cause and Try again on the card, UX
 *   round 1; the buttons come back) · success (the card re-sent with its new status replaces this one) · empty (no other
 *   models: no menu) · no reset time ("In a few minutes. Taalcut keeps trying.")
 * contrast: tokens only (ink, ink-2 on raised and canvas; Chip warning only while it actually waits)
 * pre-emit critique: P4 H5 E4 S5 R5 V4 · slop: pass (component gates: 4, 5, 10, 14, 23, 26, 30, 36, 40–41, 48, 49)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { QuestionAnswer } from '@taalcut/core';
import { ArrowRightLeft, CircleStop, Clock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Chip } from '#components/badge';
import { Button } from '#components/button';
import { useFormatters } from '#lib/format';
import { useCardActions, type ApprovalDecision } from './card-actions';
import { usePrimaryVariant } from './primary-holder';
import { AnswerFailureLine, useAnswer } from './use-answer';
import { CardFrame } from './card-frame';
import { providerLabel } from './labels';
import { VERB_ICONS } from '../icons/concepts';
import {
  Countdown,
  ModelMenu,
  SwitchedTo,
  type RateLimitCard as Card,
  type RateLimitOption,
} from './rate-limit-parts';

type Choice = 'wait' | 'stop' | 'keep' | 'switch';

/** The answer in flight, its failure, and how to send one: an approval answered with the card's choice. */
function useLimitAnswer(card: Card) {
  const answer = useAnswer<Choice>(card.status === 'waiting');
  const approvalId = card.approvalId;
  const send = async (choice: Choice, decision: ApprovalDecision, chosen: QuestionAnswer) => {
    if (approvalId) await answer.send(choice, approvalId, decision, { answer: chosen });
  };
  return {
    canAnswer: Boolean(answer.canAnswer && approvalId),
    pending: answer.pending,
    failure: answer.failure,
    wait: (as: Choice = 'wait') => send(as, 'approve', { kind: 'rateLimit', choice: 'wait' }),
    switchTo: (as: Choice, model: { provider: string; model: string }) =>
      send(as, 'approve', {
        kind: 'rateLimit',
        choice: 'switch',
        model: { provider: model.provider, model: model.model },
      }),
    stop: () => send('stop', 'deny', { kind: 'rateLimit', choice: 'stop' }),
  };
}

function Line({ card, icon, children }: { card: Card; icon: ReactNode; children: ReactNode }) {
  return (
    <div
      data-slot="smart-card"
      data-card-type="rateLimit"
      data-status={card.status}
      className="flex max-w-[65ch] items-start gap-2"
    >
      <span className="flex h-8 shrink-0 items-center">{icon}</span>
      {/* Wrapped actions start under the sentence: the ghost buttons' labels line up with its text. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3">{children}</div>
    </div>
  );
}

/** "ChatGPT is busy, so this step used claude-sonnet-5 (Anthropic). About $0.02 more." Undo for this video · Keep. */
function SwitchedLine({ card }: { card: Card }) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const answer = useLimitAnswer(card);
  const from = providerLabel(i18n, card.from.provider);
  const to = card.to ? <SwitchedTo to={card.to} /> : t`another model`;
  const extra = card.extra ? format.money(card.extra) : null;
  const sentence = {
    rate: (
      <Trans>
        {from} is busy, so this step used {to}.
      </Trans>
    ),
    plan: (
      <Trans>
        {from}’s plan limit is reached, so this step used {to}.
      </Trans>
    ),
    quota: (
      <Trans>
        Your {from} key is out of credit, so this step used {to}.
      </Trans>
    ),
  }[card.reason];
  const target = card.to;
  return (
    <Line card={card} icon={<ArrowRightLeft aria-hidden className="size-4 shrink-0 text-ink-3" />}>
      <p className="m-0 min-w-0 py-1.5 text-sm text-ink-2">
        {sentence} {extra ? <Trans>About {extra} more.</Trans> : null}
      </p>
      {answer.canAnswer && target ? (
        <span className="-ms-3 flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="ghost"
            loading={answer.pending === 'wait'}
            disabled={answer.pending !== null}
            onClick={() => void answer.wait()}
          >
            {t`Undo for this video`}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={answer.pending === 'keep'}
            disabled={answer.pending !== null}
            onClick={() => void answer.switchTo('keep', target)}
          >
            {t`Keep using it`}
          </Button>
        </span>
      ) : null}
      <AnswerFailureLine failure={answer.failure} />
    </Line>
  );
}

function ResumedLine({ card }: { card: Card }) {
  const format = useFormatters();
  const at = card.resetsAt === null ? null : format.time(card.resetsAt);
  return (
    <Line card={card} icon={<Clock aria-hidden className="size-4 shrink-0 text-ink-3" />}>
      <p className="m-0 py-1.5 text-sm text-ink-2">
        {at ? <Trans>Carried on at {at}.</Trans> : <Trans>Carried on.</Trans>}
      </p>
    </Line>
  );
}

/** Trying again is the person's next message, as for any stopped run. */
function StoppedLine({ card }: { card: Card }) {
  const { t, i18n } = useLingui();
  const { navigate } = useCardActions();
  const from = providerLabel(i18n, card.from.provider);
  return (
    <Line card={card} icon={<CircleStop aria-hidden className="size-4 shrink-0 text-ink-3" />}>
      <p className="m-0 py-1.5 text-sm text-ink-2">
        <Trans>Stopped: {from}’s limit.</Trans>
      </p>
      {navigate ? (
        <Button
          size="sm"
          variant="ghost"
          className="-ms-3"
          onClick={() => navigate({ to: 'settings', section: 'usage' })}
        >
          {t`Usage`}
        </Button>
      ) : null}
    </Line>
  );
}

/** When the run can go on: credit to add, the reset time with its countdown, or a few minutes. */
function WaitingWhen({ card, from, time }: { card: Card; from: string; time: string | null }) {
  const resetsAt = card.resetsAt;
  if (card.reason === 'quota')
    return (
      <p className="m-0 text-base">
        {card.billingUrl ? (
          <Trans>Add credit on {from}’s site, or use another model.</Trans>
        ) : (
          <Trans>Add credit to the key, or use another model.</Trans>
        )}
      </p>
    );
  if (resetsAt !== null && time)
    return (
      <div className="flex flex-col gap-0.5">
        <p className="m-0 text-base">
          <Trans>It resets around {time}.</Trans>
        </p>
        <Countdown resetsAt={resetsAt} provider={from} />
      </div>
    );
  return (
    <p className="m-0 text-base">
      <Trans>In a few minutes. Taalcut keeps trying.</Trans>
    </p>
  );
}

interface WaitingActionsProps {
  card: Card;
  answer: ReturnType<typeof useLimitAnswer>;
  /** The reset time in words, when there is one. */
  time: string | null;
}

/** The way on, as the one marigold fill: Add credit when the key is out of it, else Carry on at the reset. */
function WaitingPrimary({ card, answer, time }: WaitingActionsProps) {
  const { t } = useLingui();
  const { openExternal } = useCardActions();
  const primary = usePrimaryVariant(card.id);
  const busy = answer.pending !== null;
  const billingUrl = card.billingUrl;
  if (card.reason === 'quota')
    return billingUrl && openExternal ? (
      <Button variant={primary} size="sm" disabled={busy} onClick={() => openExternal(billingUrl)}>
        {t`Add credit`}
      </Button>
    ) : null;
  return (
    <Button
      variant={primary}
      size="sm"
      loading={answer.pending === 'wait'}
      disabled={busy && answer.pending !== 'wait'}
      onClick={() => void answer.wait()}
    >
      {time ? t`Carry on at ${time}` : t`Wait and carry on`}
    </Button>
  );
}

/** The answers: the way on, Use another model (when there are others) and Stop. */
function WaitingActions({ card, answer, time }: WaitingActionsProps) {
  const { t } = useLingui();
  if (!answer.canAnswer) return null;
  const busy = answer.pending !== null;
  return (
    <div className="flex flex-wrap gap-2">
      <WaitingPrimary card={card} answer={answer} time={time} />
      {card.options.length > 0 ? (
        <ModelMenu
          options={card.options}
          busy={busy}
          loading={answer.pending === 'switch'}
          onPick={(option: RateLimitOption) => void answer.switchTo('switch', option)}
        />
      ) : null}
      <Button
        size="sm"
        icon={VERB_ICONS.stop}
        loading={answer.pending === 'stop'}
        disabled={busy && answer.pending !== 'stop'}
        onClick={() => void answer.stop()}
      >
        {t`Stop`}
      </Button>
    </div>
  );
}

/** Every model in the chain is limited: the run pauses and asks how to go on. */
function WaitingCard({ card }: { card: Card }) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const answer = useLimitAnswer(card);
  const from = providerLabel(i18n, card.from.provider);
  const quota = card.reason === 'quota';
  const title = {
    rate: t`${from} is busy`,
    plan: t`${from}’s plan limit is reached`,
    quota: t`Your ${from} key is out of credit`,
  }[card.reason];
  const resetsAt = quota ? null : card.resetsAt;
  const time = resetsAt === null ? null : format.time(resetsAt);
  return (
    <CardFrame
      cardType="rateLimit"
      data-status={card.status}
      title={title}
      aside={<Chip tone="warning">{t`Paused`}</Chip>}
    >
      <WaitingWhen card={card} from={from} time={time} />
      <p className="m-0 text-sm text-ink-2">
        {quota ? (
          <Trans>The run is paused, not stopped. Nothing is lost.</Trans>
        ) : (
          <Trans>The run is paused, not stopped, and carries on by itself, even after a restart.</Trans>
        )}
      </p>
      <WaitingActions card={card} answer={answer} time={time} />
      <AnswerFailureLine failure={answer.failure} />
    </CardFrame>
  );
}

/** G8: a limit met a run. One line when nothing is asked; a decision card while the run waits for an answer. */
export function RateLimitCardView({ card }: { card: Card }) {
  switch (card.status) {
    case 'switched':
      return <SwitchedLine card={card} />;
    case 'resumed':
      return <ResumedLine card={card} />;
    case 'stopped':
      return <StoppedLine card={card} />;
    case 'waiting':
      return <WaitingCard card={card} />;
  }
}
