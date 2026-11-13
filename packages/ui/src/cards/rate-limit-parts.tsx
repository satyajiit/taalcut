// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: rateLimit card parts · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the model names (as written, never translated), the countdown (a quiet ink-2 line that
 *   changes once a minute, never each second; aria-live off, with one polite announcement at the last minute) and
 *   the Use another model menu (opens at once, as every menu; each row the model, where it runs and about what it
 *   costs; this Mac "On this Mac, free")
 * states: default · hover/focus/active (Button; menu rows take the hover surface) · disabled (another answer in
 *   flight) · loading (the menu's button spins while a switch is answered) · error and success (the card's)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { CardOf } from '@taalcut/core';
import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '#components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#components/dropdown-menu';
import { ProviderLogo } from '#components/provider-logo';
import { useFormatters } from '#lib/format';
import { providerLabel } from './labels';

export type RateLimitCard = CardOf<'rateLimit'>;
export type RateLimitOption = RateLimitCard['options'][number];

/** A model id: shown as written, so translation tools leave it alone. */
export function ModelName({ model }: { model: string }) {
  return (
    <span translate="no" className="font-medium text-ink">
      {model}
    </span>
  );
}

/** Where the step went: "claude-sonnet-5 (Anthropic)", or "qwen3.5-4b on this Mac". */
export function SwitchedTo({ to }: { to: NonNullable<RateLimitCard['to']> }) {
  const { i18n } = useLingui();
  const name = <ModelName model={to.model} />;
  if (to.local) return <Trans>{name} on this Mac</Trans>;
  const provider = providerLabel(i18n, to.provider);
  return (
    <Trans>
      {name} ({provider})
    </Trans>
  );
}

/** Now, moved on at each whole minute before `target`, so the countdown changes once a minute. */
function useMinuteClock(target: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const remaining = target - now;
    if (remaining <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), remaining % 60_000 || 60_000);
    return () => clearTimeout(timer);
  }, [target, now]);
  return now;
}

/**
 * "In 12 minutes" until the limit resets. Not a live region (it would talk every minute); a polite line says once,
 * at the last minute, that it is nearly time.
 */
export function Countdown({ resetsAt, provider }: { resetsAt: number; provider: string }) {
  const { t } = useLingui();
  const format = useFormatters();
  const now = useMinuteClock(resetsAt);
  const remaining = resetsAt - now;
  const lastMinute = remaining <= 60_000;
  return (
    <>
      <p aria-live="off" data-slot="rate-limit-countdown" className="m-0 text-sm text-ink-2 tabular-nums">
        {remaining > 0 ? (
          // Intl's words for the moment it resets (a <time>, as every Intl-formatted moment is), in the sentence's face.
          <time dateTime={new Date(resetsAt).toISOString()} className="font-sans">
            {format.untilFromNow(remaining)}
          </time>
        ) : (
          t`Any moment now.`
        )}
      </p>
      <span role="status" className="sr-only">
        {lastMinute ? t`${provider} resets in about a minute.` : ''}
      </span>
    </>
  );
}

const optionKey = (option: RateLimitOption) => `${option.provider}:${option.model}`;

/** Use another model: the module's other options, cheapest first and this Mac last, as the card lists them. */
export function ModelMenu({
  options,
  busy,
  loading,
  onPick,
}: {
  options: readonly RateLimitOption[];
  busy: boolean;
  loading: boolean;
  onPick: (option: RateLimitOption) => void;
}) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const cost = (option: RateLimitOption) => {
    if (option.local) return t`On this Mac, free`;
    const provider = providerLabel(i18n, option.provider);
    if (!option.estimate) return provider;
    const money = format.money(option.estimate);
    return t`${provider} · about ${money}`;
  };
  return (
    // Not modal: a menu inside a chat card leaves the rest of the page as it is (no aria-hidden over it).
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={busy}>
        <Button size="sm" loading={loading}>
          {t`Use another model`}
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-64">
        {options.map((option) => (
          <DropdownMenuItem key={optionKey(option)} onSelect={() => onPick(option)} className="gap-3">
            <ProviderLogo provider={option.local ? 'local' : option.provider} size="xs" framed={false} />
            <span translate="no" className="min-w-0 flex-1 truncate font-medium">
              {option.model}
            </span>
            <span className="shrink-0 text-sm text-ink-2 tabular-nums">{cost(option)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
