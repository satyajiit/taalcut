// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: cheaper models · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * hairline rows: the model (as written), where it runs, what the same work costs ("free, slower" on this Mac), and
 *   Use this; this Mac first
 * states: default · hover/focus/active (the Buttons') · disabled (another answer in flight, or the run ended) ·
 *   loading (this row's button, through the command and the answer) · error (the cause under the list) ·
 *   success (the card settles: "Switched to …") */

import { useLingui } from '@lingui/react/macro';
import { useId } from 'react';
import type { CheaperOption } from '@taalcut/core';
import { Button } from '#components/button';
import { ProviderLogo } from '#components/provider-logo';
import { useFormatters } from '#lib/format';
import { useHostPlatform } from '../platform/host-platform';
import { onPlan } from './cost-parts';
import { providerLabel } from './labels';

export interface CheaperOptionsProps {
  options: readonly CheaperOption[];
  /** The option whose switch is in flight. */
  busy: CheaperOption | null;
  disabled: boolean;
  onPick: (option: CheaperOption) => void;
}

export const optionKey = (option: CheaperOption) => `${option.module}:${option.provider}:${option.model}`;

/** Models that would do the same work for less, this Mac first ("free, slower"). */
export function CheaperOptions({ options, busy, disabled, onPick }: CheaperOptionsProps) {
  const { t, i18n } = useLingui();
  const format = useFormatters();
  const here = useHostPlatform() === 'mac' ? t`This Mac` : t`This computer`;
  const sorted = [...options].sort((a, b) => Number(b.local) - Number(a.local));
  const base = useId();
  return (
    <ul aria-label={t`Cheaper models`} className="m-0 flex list-none flex-col p-0">
      {sorted.map((option) => {
        const where = option.local ? here : providerLabel(i18n, option.provider);
        const cost = format.money(option.estimate);
        const price = option.local
          ? t`free, slower`
          : onPlan(option.provider)
            ? t`on your plan`
            : t`about ${cost}`;
        const mine = busy !== null && optionKey(busy) === optionKey(option);
        const nameId = `${base}-${optionKey(option)}`;
        return (
          <li
            key={optionKey(option)}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-rule-subtle py-2 first:border-t-0"
          >
            <ProviderLogo provider={option.local ? 'local' : option.provider} size="xs" framed={false} />
            <span className="flex min-w-0 flex-[1_1_14rem] flex-col">
              <span id={nameId} className="truncate text-sm font-medium text-ink" translate="no">
                {option.model}
              </span>
              <span className="text-xs text-ink-2 tabular-nums">
                <span translate={option.local ? undefined : 'no'}>{where}</span> · {price}
              </span>
            </span>
            <Button
              size="sm"
              loading={mine}
              disabled={disabled || (busy !== null && !mine)}
              aria-describedby={nameId}
              onClick={() => onPick(option)}
            >
              {t`Use this`}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
