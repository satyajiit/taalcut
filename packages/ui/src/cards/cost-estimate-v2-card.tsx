// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: cost estimate (version 2) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · a compact line on the canvas while it goes ahead; the decision card's frame only when it
 *   asks. Money through Intl; models as written (translate="no"); this Mac (this computer off a Mac) says "free", and
 *   the ChatGPT plan "on your plan"
 * lines: tokens, or what the provider bills instead (P3: images, characters, seconds of audio); "about" when estimated
 * states: default (going ahead: "about $0.14 · Going ahead") · hover/focus/active (Details, the Buttons) · disabled
 *   (the run ended: actions answer with why) · loading (the pressed button) · error (the cause under the actions) ·
 *   success (settled: "Cost $0.10 (about $0.12 expected)"; switched: "Switched to …"; stopped: "Stopped")
 * motion: Details opens with the Arrival (8 px, 220 ms); the cap bar scales on transform
 * UX round 1: a failed answer stays on the card (its cause and Try again) and never settles it as switched; Spend it
 *   is marigold only while this card holds the transcript's one primary */

import { Trans, useLingui } from '@lingui/react/macro';
import type { CheaperOption, CostEstimateCardV2, TaalcutError } from '@taalcut/core';
import { CircleCheck, CircleStop } from 'lucide-react';
import { useState } from 'react';
import { Arrival } from '../chat/arrival';
import { Button } from '#components/button';
import { useFormatters } from '#lib/format';
import { useCardActions } from './card-actions';
import { CardFrame } from './card-frame';
import { CheaperOptions } from './cheaper-options';
import { overrideCommand } from './cost-parts';
import { CostBreakdown } from './cost-breakdown';
import { ErrorLine } from './error-line';
import { flowStepLabel } from './flow-labels';
import { usePrimaryVariant } from './primary-holder';
import { AnswerFailureLine, useAnswer } from './use-answer';
import { VERB_ICONS } from '../icons/concepts';

/**
 * What a flow step will cost before it runs (P2-X1): "about $0.14", by model,
 * and what is left of the project's cap. It goes ahead without waiting unless
 * it asks; a cheaper model or Stop are there either way. Afterwards it says
 * what the step really cost.
 */
export function CostEstimateV2Card({
  card,
  presentation = 'default',
}: {
  card: CostEstimateCardV2;
  /** Within a run's activity, the breakdown is already revealed; live controls never wait for a disclosure. */
  presentation?: 'default' | 'inline';
}) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const actions = useCardActions();
  const [open, setOpen] = useState(false);
  const inline = presentation === 'inline';
  const expanded = inline || open;
  const [cheaper, setCheaper] = useState(false);
  const [busy, setBusy] = useState<'approve' | 'stop' | CheaperOption | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  const [switched, setSwitched] = useState<string | null>(null);
  const name = flowStepLabel(i18n, card.phase.labelKey);
  const estimate = card.estimate.money ? format.money(card.estimate.money) : t`free`;
  const asking = card.status === 'asking' && card.approvalId !== undefined;
  const live = card.status === 'going-ahead' || asking;
  const settledTo = switched !== null || card.status === 'switched';

  const answer = useAnswer<'approve' | 'stop' | 'switch'>(card.status === 'asking');
  const primary = usePrimaryVariant(card.id);
  const canAnswer = asking && answer.canAnswer;

  const stop = async () => {
    setBusy('stop');
    setError(null);
    if (canAnswer && card.approvalId) await answer.send('stop', card.approvalId, 'deny');
    else if (actions.stopRun) {
      const result = await actions.stopRun(card.runId);
      if (!result.ok) setError(result.error);
    }
    setBusy(null);
  };
  const approve = async () => {
    if (!canAnswer || !card.approvalId) return;
    setBusy('approve');
    await answer.send('approve', card.approvalId, 'approve');
    setBusy(null);
  };
  const switchTo = async (option: CheaperOption) => {
    if (!actions.dispatch) return;
    setBusy(option);
    setError(null);
    const result = await actions.dispatch(...overrideCommand(option));
    if (!result.ok) {
      setBusy(null);
      return setError(result.error);
    }
    // The model is switched; the run only goes on once it has the answer, so a failed answer doesn't settle it.
    const outcome =
      canAnswer && card.approvalId ? await answer.send('switch', card.approvalId, 'approve') : 'answered';
    setBusy(null);
    if (outcome === null) return;
    setSwitched(option.model);
    setCheaper(false);
  };

  const actual = card.actual?.money ? format.money(card.actual.money) : null;
  const summary = actual ? (
    <span>{t`${name}: cost ${actual} (about ${estimate} expected)`}</span>
  ) : (
    <span>{t`${name}: about ${estimate}`}</span>
  );
  const state = settledTo ? (
    <span className="text-ink-2">
      {switched ? (
        <Trans>
          Switched to <span translate="no">{switched}</span>
        </Trans>
      ) : (
        t`Switched to a cheaper model`
      )}
    </span>
  ) : card.status === 'stopped' ? (
    <span className="inline-flex items-center gap-1 text-ink-2">
      <CircleStop aria-hidden className="size-3.5" />
      {t`Stopped`}
    </span>
  ) : card.status === 'settled' ? (
    <span className="inline-flex items-center gap-1 text-ink-2">
      <CircleCheck aria-hidden className="size-3.5 text-success-strong" />
      {t`Done`}
    </span>
  ) : card.status === 'going-ahead' ? (
    <span className="text-ink-2">{t`Going ahead`}</span>
  ) : null;

  const liveActions =
    live && !settledTo ? (
      <div className="flex flex-wrap items-center gap-2">
        {canAnswer ? (
          <Button
            variant={primary}
            size="sm"
            loading={busy === 'approve'}
            disabled={busy !== null && busy !== 'approve'}
            onClick={() => void approve()}
          >
            {t`Spend it`}
          </Button>
        ) : null}
        {card.cheaper.length > 0 && actions.dispatch ? (
          <Button
            size="sm"
            aria-expanded={cheaper}
            disabled={busy === 'approve' || busy === 'stop'}
            onClick={() => setCheaper((was) => !was)}
          >
            {t`Use a cheaper model`}
          </Button>
        ) : null}
        {actions.stopRun || canAnswer ? (
          <Button
            variant="ghost"
            size="sm"
            icon={VERB_ICONS.stop}
            loading={busy === 'stop'}
            disabled={busy !== null && busy !== 'stop'}
            onClick={() => void stop()}
          >
            {t`Stop`}
          </Button>
        ) : null}
      </div>
    ) : null;

  const body = (
    <>
      <CostBreakdown
        card={card}
        inline={inline}
        asking={asking}
        open={open}
        onToggle={() => setOpen((was) => !was)}
        summary={summary}
        state={state}
      >
        {!asking && !inline ? liveActions : null}
      </CostBreakdown>
      {asking || inline ? liveActions : null}
      {cheaper && live && !settledTo && (asking || expanded) ? (
        <Arrival animate>
          <CheaperOptions
            options={card.cheaper}
            busy={typeof busy === 'object' ? busy : null}
            disabled={busy === 'approve' || busy === 'stop'}
            onPick={(option) => void switchTo(option)}
          />
        </Arrival>
      ) : null}
      {error ? <ErrorLine error={error} /> : null}
      <AnswerFailureLine failure={answer.failure} />
    </>
  );

  if (asking) {
    return (
      <CardFrame
        cardType="costEstimate"
        data-version={2}
        data-status={card.status}
        title={t`Spend money on this?`}
      >
        {body}
      </CardFrame>
    );
  }
  return (
    <article
      data-slot="smart-card"
      data-card-type="costEstimate"
      data-version={2}
      data-status={card.status}
      aria-label={t`What ${name} costs`}
      className="flex max-w-[42rem] flex-col gap-2"
    >
      {body}
    </article>
  );
}
