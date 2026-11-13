// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: cost-estimate-card · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 (A3) · a decision card: hairline frame, no icon, no edge · its buttons
 * carry default · hover · focus · active · disabled · loading · error · success (Button)
 * UX round 1: when it asks, the money is the title ("Spend about $0.042?") and the step, tokens, time and what is
 *   left sit in view (no Details to open), so the card and the agent's sentence above it say the same amount; a
 *   failed answer stays on the card with Try again; Spend it is marigold only while this card holds the one primary
 * pre-emit critique: P5 H5 E4 S5 R5 V4 */

import { Plural, useLingui } from '@lingui/react/macro';
import type { CostEstimateCardV1 } from '@taalcut/core';
import { ChevronDown, Coins } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { Button } from '#components/button';
import { useFormatters, type Formatters } from '#lib/format';
import type { ApprovalDecision } from './card-actions';
import { CardFrame } from './card-frame';
import { toolLabel } from './labels';
import { usePrimaryVariant } from './primary-holder';
import { AnswerFailureLine, useAnswer } from './use-answer';

type Amounts = CostEstimateCardV1['estimate'];

function useAmountRows(amounts: Amounts | undefined, format: Formatters): [string, string][] {
  const { t } = useLingui();
  if (!amounts) return [];
  const rows: [string, string][] = [];
  if (amounts.money) rows.push([t`Cost`, format.money(amounts.money)]);
  if (amounts.tokens !== undefined) rows.push([t`Tokens`, format.count(amounts.tokens)]);
  if (amounts.durationMs !== undefined) rows.push([t`Time`, format.duration(amounts.durationMs)]);
  return rows;
}

/** What is left of the budget, each amount with its unit: "$1.58 · 188,000 tokens · 4m". */
function AmountsLeft({ amounts, format }: { amounts: Amounts; format: Formatters }) {
  const parts: ReactNode[] = [];
  if (amounts.money) parts.push(format.money(amounts.money));
  if (amounts.tokens !== undefined)
    parts.push(<Plural key="tokens" value={amounts.tokens} one="# token" other="# tokens" />);
  if (amounts.durationMs !== undefined) parts.push(format.duration(amounts.durationMs));
  return (
    <span className="tabular-nums">
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 ? ' · ' : null}
          {part}
        </Fragment>
      ))}
    </span>
  );
}

/** The step, its tokens and its time, as one quiet line: "Look at a frame · 12,400 tokens · 9s". */
function StepLine({ card, format }: { card: CostEstimateCardV1; format: Formatters }) {
  const { i18n } = useLingui();
  const parts: ReactNode[] = [];
  if (card.tool) parts.push(toolLabel(i18n, card.tool));
  if (card.estimate.tokens !== undefined)
    parts.push(<Plural key="tokens" value={card.estimate.tokens} one="# token" other="# tokens" />);
  if (card.estimate.durationMs !== undefined) parts.push(format.duration(card.estimate.durationMs));
  if (parts.length === 0) return null;
  return (
    <p className="m-0 text-sm text-ink-2 tabular-nums">
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 ? ' · ' : null}
          {part}
        </Fragment>
      ))}
    </p>
  );
}

/**
 * What a step will cost before it runs (PRD 8.4 budgets), with the budget left. Version 1 of the
 * card, the run budget's; CostEstimateCardView picks it by version.
 * Stays collapsed as a compact pill unless approval is required.
 */
export function CostEstimateCard({ card }: { card: CostEstimateCardV1 }) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const answer = useAnswer<ApprovalDecision>(card.requiresApproval);
  const primary = usePrimaryVariant(card.id);
  const estimate = useAmountRows(card.estimate, format);
  const approvalId = card.approvalId;
  const tool = card.tool ? toolLabel(i18n, card.tool) : undefined;
  const title = tool ? t`Estimated cost: ${tool}` : t`Estimated cost`;

  const remaining = card.remaining ? (
    <p className="m-0 text-xs text-ink-2">
      {t`Left in this chat's budget:`} <AmountsLeft amounts={card.remaining} format={format} />
    </p>
  ) : null;

  if (!card.requiresApproval) {
    return (
      <details
        data-slot="smart-card"
        data-card-type="costEstimate"
        className="group/cost-v1 flex max-w-[42rem] flex-col"
      >
        <summary className="inline-flex w-fit cursor-pointer list-none items-center gap-2 rounded-md border border-rule-subtle bg-chip px-2.5 py-1 text-xs text-ink-2 transition-colors duration-(--dur-micro) ease-(--ease-out) hover:bg-hover hover:text-ink [&::-webkit-details-marker]:hidden">
          <Coins aria-hidden className="size-3.5 shrink-0 text-ink-3" />
          <span className="font-medium text-ink">{title}</span>
          <ChevronDown
            aria-hidden
            className="size-3.5 text-ink-3 transition-transform duration-(--dur-micro) ease-(--ease-out) group-open/cost-v1:rotate-180"
          />
        </summary>
        <div className="mt-1 flex flex-col gap-2 rounded-lg border border-rule-subtle bg-panel px-3 py-2">
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            {estimate.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-ink-2">{label}</dt>
                <dd className="m-0 font-semibold text-ink tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {remaining}
        </div>
      </details>
    );
  }

  const money = card.estimate.money ? format.money(card.estimate.money) : null;
  const send = (decision: ApprovalDecision) => {
    if (approvalId) void answer.send(decision, approvalId, decision);
  };
  return (
    <CardFrame cardType="costEstimate" title={money ? t`Spend about ${money}?` : t`Go ahead with this step?`}>
      <div className="flex flex-col gap-1">
        <StepLine card={card} format={format} />
        {remaining}
      </div>
      {approvalId && answer.canAnswer ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant={primary}
            size="sm"
            loading={answer.pending === 'approve'}
            disabled={answer.pending === 'deny'}
            onClick={() => send('approve')}
          >
            {t`Spend it`}
          </Button>
          <Button
            size="sm"
            loading={answer.pending === 'deny'}
            disabled={answer.pending === 'approve'}
            onClick={() => send('deny')}
          >
            {t`Find a cheaper way`}
          </Button>
        </div>
      ) : null}
      <AnswerFailureLine failure={answer.failure} />
    </CardFrame>
  );
}
