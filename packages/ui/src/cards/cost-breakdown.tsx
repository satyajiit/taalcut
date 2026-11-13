// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · component: cost-breakdown · mode: Operate · system: DESIGN.md (A3)
 * Inline inside the activity; standalone decisions retain their contextual breakdown control.
 * States: open/closed · hover/focus/press. Reveal respects the shared reduced-motion behavior. */

import type { I18n } from '@lingui/core';
import { msg, plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { Billed, CostEstimateCardV2 } from '@taalcut/core';
import { ChevronDown, Coins } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Button } from '#components/button';
import { ProviderLogo } from '#components/provider-logo';
import { cn } from '#lib/cn';
import { useFormatters } from '#lib/format';
import { Arrival } from '../chat/arrival';
import { useHostPlatform } from '../platform/host-platform';
import { CapMeter, onPlan } from './cost-parts';
import { providerLabel } from './labels';

/** What a provider bills when it isn't tokens (P3): "4 images", "1,240 characters", "18 seconds of audio". */
function billedAmount(i18n: I18n, billed: Billed): string | null {
  const count = Math.round(billed.quantity);
  switch (billed.unit) {
    case 'token':
      return null;
    case 'character':
      return i18n._(msg`${plural(count, { one: '# character', other: '# characters' })}`);
    case 'second':
      return i18n._(msg`${plural(count, { one: '# second of audio', other: '# seconds of audio' })}`);
    case 'image':
      return i18n._(msg`${plural(count, { one: '# image', other: '# images' })}`);
    case 'credit':
      return i18n._(msg`${plural(count, { one: '# credit', other: '# credits' })}`);
  }
}

/** Each model's share: provider and model as written, tokens (or what it bills), money ("about" when estimated). */
function Lines({ card }: { card: CostEstimateCardV2 }) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const here = useHostPlatform() === 'mac' ? t`This Mac` : t`This computer`;
  return (
    <ul aria-label={t`By model`} className="m-0 flex list-none flex-col p-0">
      {card.lines.map((line) => {
        const tokens = format.count(line.tokens);
        const billed = line.billed ? billedAmount(i18n, line.billed) : null;
        const money = format.money(line.money);
        return (
          <li
            key={`${line.module}:${line.provider}:${line.model}`}
            className="flex flex-wrap items-center gap-x-2.5 border-t border-rule-subtle py-1.5 text-sm first:border-t-0"
          >
            <ProviderLogo provider={line.local ? 'local' : line.provider} size="xs" framed={false} />
            <span className="min-w-0 flex-1 truncate text-ink">
              <span translate="no">{line.model}</span>
              <span className="text-ink-2">
                {' · '}
                {line.local ? here : <span translate="no">{providerLabel(i18n, line.provider)}</span>}
              </span>
            </span>
            <span className="text-xs text-ink-3 tabular-nums">{billed ?? t`${tokens} tokens`}</span>
            <span className="min-w-16 text-end font-medium text-ink tabular-nums">
              {line.local
                ? t`free`
                : onPlan(line.provider)
                  ? t`on your plan`
                  : line.estimated
                    ? t`about ${money}`
                    : money}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

interface CostBreakdownProps {
  card: CostEstimateCardV2;
  inline: boolean;
  asking: boolean;
  open: boolean;
  onToggle: () => void;
  summary: ReactNode;
  state: ReactNode;
  children?: ReactNode;
}

/** The same model costs read inline in activity and on demand beside a spending decision. */
export function CostBreakdown({
  card,
  inline,
  asking,
  open,
  onToggle,
  summary,
  state,
  children,
}: CostBreakdownProps) {
  const { t } = useLingui();
  const detailsId = useId();
  return (
    <>
      <div
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-1',
          !asking && !inline && 'w-fit rounded-md border border-rule-subtle bg-chip px-2.5 py-1',
        )}
      >
        <p className="m-0 flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-xs text-ink-2 tabular-nums">
          {asking ? null : <Coins aria-hidden className="size-3.5 shrink-0 self-center text-ink-3" />}
          <span className="font-medium text-ink">{summary}</span>
          {state ? <span aria-hidden="true">·</span> : null}
          {state}
        </p>
        {!inline ? (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-controls={detailsId}
            className={cn(!asking && 'h-6 px-2 text-xs')}
            onClick={onToggle}
          >
            {t`Cost breakdown`}
            <ChevronDown
              aria-hidden
              className={cn(
                'transition-transform duration-(--dur-short) ease-(--ease-out)',
                open && 'rotate-180',
              )}
            />
          </Button>
        ) : null}
      </div>
      {inline || open ? (
        <Arrival animate={!inline} className="flex flex-col gap-3">
          <div
            id={detailsId}
            className={cn(
              'flex flex-col gap-3',
              !asking && !inline && 'rounded-lg border border-rule-subtle bg-panel p-3',
            )}
          >
            <Lines card={card} />
            {card.cap ? (
              <CapMeter cap={card.cap.cap} spent={card.cap.spent} next={card.estimate.money} />
            ) : null}
            {children}
          </div>
        </Arrival>
      ) : null}
    </>
  );
}
