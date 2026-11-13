// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 (round P3-3: an external agent's ask names it above the meter
 *   and links to what it may do, as the approval card does; UX round 1: a failed answer keeps the card open with its
 *   cause and Try again, never "Raised to …"; Raise and go on is marigold only while this card holds the one primary)
 * Hallmark · component: budgetCap card · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * a decision card (raised, hairline all round, xl radius, no shadow, no stripe, title at 700): the cap as a neutral
 *   meter with a warning icon and words, what's next with its estimate, then the three answers: raise the cap (a money
 *   field filled with the suggestion, the card's one primary), a cheaper model (this Mac first: "free, slower"), stop
 * states: default (pending) · hover/focus/active (field and Buttons) · disabled (an answer in flight; expired) ·
 *   loading (on the pressed button, through the command and the approval) · error (a bad amount, or the command
 *   failed: the cause under the field, no approval sent) · success (settled in one line: "Raised to $3.00",
 *   "Switched to …", "Stopped") · expired ("The run ended before you answered.") */

import { Trans, useLingui } from '@lingui/react/macro';
import type { CardOf, CheaperOption, Money, TaalcutError } from '@taalcut/core';
import { CircleCheck, CircleStop } from 'lucide-react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '#components/button';
import { MoneyInput } from '#components/money-input';
import { useFormatters } from '#lib/format';
import { moneyFieldText, parseMoneyText } from '#lib/money';
import { useCardActions } from './card-actions';
import { ApprovalRequester, RequesterSettingsLink } from './approval-requester';
import { CardFrame } from './card-frame';
import { CheaperOptions } from './cheaper-options';
import { CapMeter, overrideCommand, SET_PROJECT_CAP } from './cost-parts';
import { ErrorLine } from './error-line';
import { flowStepLabel } from './flow-labels';
import { usePrimaryVariant } from './primary-holder';
import { AnswerFailureLine, useAnswer } from './use-answer';

type Answer = { kind: 'raised'; cap: Money } | { kind: 'switched'; model: string } | { kind: 'stopped' };

/**
 * The next step doesn't fit the project's cap (G8): the run paused here. Only
 * a person changes a cap (the bus refuses the agent): raising it is the
 * command first, then the approval, and a failed command sends no approval.
 */
export function BudgetCapCard({ card }: { card: CardOf<'budgetCap'> }) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const actions = useCardActions();
  const fieldId = useId();
  const helpId = useId();
  const [text, setText] = useState(() => moneyFieldText(card.suggestedCap, i18n.locale));
  const [busy, setBusy] = useState<'raise' | 'stop' | CheaperOption | null>(null);
  const [wrong, setWrong] = useState<string | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  const [answered, setAnswered] = useState<Answer | null>(null);
  const next = flowStepLabel(i18n, card.next.labelKey);
  const currency = card.cap.currency;
  const pending = card.status === 'pending' && answered === null;
  // A paid call outside a project has no cap of its own to raise (the agent sends an empty id).
  const canRaise = Boolean(actions.dispatch && card.projectId);
  const answer = useAnswer<'raise' | 'switch' | 'stop'>(card.status === 'pending');
  const primary = usePrimaryVariant(card.id);

  /** The approval after a command that worked: whether the run took it (a failure stays on the card). */
  const approve = async (key: 'raise' | 'switch') =>
    !answer.canAnswer || (await answer.send(key, card.approvalId, 'approve')) === 'answered';

  const raise = async (event: FormEvent) => {
    event.preventDefault();
    if (!actions.dispatch || !canRaise || busy) return;
    const micros = parseMoneyText(text, i18n.locale, currency);
    if (micros === null) {
      const example = moneyFieldText(card.suggestedCap, i18n.locale);
      return setWrong(t`Enter an amount, like ${example}.`);
    }
    if (micros <= card.spent.micros) {
      const spent = format.money(card.spent);
      return setWrong(t`Enter more than ${spent}, what’s already spent.`);
    }
    setWrong(null);
    setError(null);
    setBusy('raise');
    const cap = { currency, micros };
    const result = await actions.dispatch(SET_PROJECT_CAP, { projectId: card.projectId, cap });
    if (!result.ok) {
      setBusy(null);
      return setError(result.error);
    }
    const went = await approve('raise');
    setBusy(null);
    if (went) setAnswered({ kind: 'raised', cap });
  };

  const switchTo = async (option: CheaperOption) => {
    if (!actions.dispatch) return;
    setError(null);
    setBusy(option);
    const result = await actions.dispatch(...overrideCommand(option));
    if (!result.ok) {
      setBusy(null);
      return setError(result.error);
    }
    const went = await approve('switch');
    setBusy(null);
    if (went) setAnswered({ kind: 'switched', model: option.model });
  };

  const stop = async () => {
    if (!answer.canAnswer) return;
    setBusy('stop');
    const outcome = await answer.send('stop', card.approvalId, 'deny');
    setBusy(null);
    if (outcome === 'answered') setAnswered({ kind: 'stopped' });
  };

  const settled = settledKind(card, answered) !== null;
  const nextCost = format.money(card.next.estimate);
  return (
    <CardFrame
      cardType="budgetCap"
      data-status={answered?.kind ?? card.status}
      title={t`This would go over this project’s budget`}
    >
      {card.requester ? <ApprovalRequester requester={card.requester} /> : null}
      <CapMeter always cap={card.cap} spent={card.spent} next={pending ? card.next.estimate : undefined} />
      <p className="m-0 text-sm text-ink tabular-nums">{t`Next: ${next}, about ${nextCost}.`}</p>
      {settled ? (
        <SettledLine card={card} answered={answered} />
      ) : (
        <>
          <form noValidate onSubmit={(event) => void raise(event)} className="flex flex-col gap-1.5">
            <label htmlFor={fieldId} className="text-sm font-medium text-ink">
              {t`Raise the cap to`}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <MoneyInput
                id={fieldId}
                currency={currency}
                value={text}
                invalid={wrong !== null}
                aria-describedby={helpId}
                disabled={busy !== null && busy !== 'raise'}
                onChange={(event) => {
                  setText(event.target.value);
                  if (wrong) setWrong(null);
                }}
                className="w-32"
              />
              <Button
                type="submit"
                variant={primary}
                size="sm"
                loading={busy === 'raise'}
                disabled={!canRaise || (busy !== null && busy !== 'raise')}
              >
                {t`Raise and go on`}
              </Button>
            </div>
            <p
              id={helpId}
              role={wrong ? 'alert' : undefined}
              className={wrong ? 'm-0 text-sm text-danger-strong' : 'm-0 text-xs text-ink-2'}
            >
              {wrong ?? t`Only you can change a project’s budget. Taalcut never raises it.`}
            </p>
          </form>
          {card.cheaper.length > 0 ? (
            <div className="flex flex-col gap-1 border-t border-rule-subtle pt-3">
              <h4 className="m-0 text-sm font-medium text-ink">{t`Or use a cheaper model for this step`}</h4>
              <CheaperOptions
                options={card.cheaper}
                busy={typeof busy === 'object' ? busy : null}
                disabled={!actions.dispatch || busy === 'raise' || busy === 'stop'}
                onPick={(option) => void switchTo(option)}
              />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 border-t border-rule-subtle pt-3">
            <Button
              variant="ghost"
              size="sm"
              loading={busy === 'stop'}
              disabled={!answer.canAnswer || (busy !== null && busy !== 'stop')}
              onClick={() => void stop()}
            >
              {t`Stop here`}
            </Button>
            <span className="text-xs text-ink-2">{t`What’s done so far stays.`}</span>
          </div>
        </>
      )}
      {error ? <ErrorLine error={error} /> : null}
      <AnswerFailureLine failure={answer.failure} />
      {card.requester ? <RequesterSettingsLink requester={card.requester} /> : null}
    </CardFrame>
  );
}

/** Whether the card is settled: what this window answered, or the status the agent sent. */
function settledKind(card: CardOf<'budgetCap'>, answered: Answer | null) {
  return answered?.kind ?? (card.status === 'pending' ? null : card.status);
}

/** The one line a settled card says. */
function SettledLine({ card, answered }: { card: CardOf<'budgetCap'>; answered: Answer | null }) {
  const { t } = useLingui();
  const format = useFormatters();
  const kind = settledKind(card, answered);
  const done = <CircleCheck aria-hidden className="size-4 shrink-0 text-success-strong" />;
  const stopped = <CircleStop aria-hidden className="size-4 shrink-0 text-ink-3" />;
  let icon: ReactNode = done;
  let text: ReactNode;
  switch (kind) {
    case 'raised': {
      const cap = answered?.kind === 'raised' ? format.money(answered.cap) : null;
      text = cap ? t`Raised to ${cap}` : t`Raised`;
      break;
    }
    case 'switched': {
      const model = answered?.kind === 'switched' ? answered.model : null;
      text = model ? (
        <Trans>
          Switched to <span translate="no">{model}</span>
        </Trans>
      ) : (
        t`Switched to a cheaper model`
      );
      break;
    }
    case 'stopped':
      icon = stopped;
      text = t`Stopped at your budget`;
      break;
    case 'expired':
      icon = stopped;
      text = t`The run ended before you answered.`;
      break;
    default:
      return null;
  }
  return (
    <p role="status" className="m-0 flex items-center gap-1.5 text-sm text-ink-2">
      {icon}
      <span>{text}</span>
    </p>
  );
}
