// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: trend filter pill (Templates) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * the filter pill's look for the trend date: Any, or May be stale, with the rule in words under the choices (a trend
 *   date older than 90 days: the sound or style may have moved on). Set, the pill reads "Trend may be stale" on the
 *   selection wash. Replaces the separate toggle that pushed the filter row onto two lines (UX1 M10)
 * states: default · hover (hover surface) · focus-visible (base ring) · active (pressed surface) · open (pressed,
 *   chevron turned) · set (selection wash, strong edge) · disabled n/a · loading/error/success n/a: the list answers
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 */
import { useLingui } from '@lingui/react/macro';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@taalcut/ui';
import { ChevronDown, Clock } from 'lucide-react';
import { PILL_CHEVRON_CLASS, PILL_CLASS } from './pill';
import { STALE_AFTER_DAYS } from './template-search';

const ANY = 'any';
const STALE = 'stale';

export function TrendPill({
  stale,
  onChange,
}: {
  readonly stale: boolean;
  readonly onChange: (stale: true | undefined) => void;
}) {
  const { t, i18n } = useLingui();
  const days = i18n.number(STALE_AFTER_DAYS);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger data-slot="filter-pill" data-set={stale || undefined} className={PILL_CLASS}>
        <Clock aria-hidden />
        <span className={stale ? 'font-medium' : undefined}>{stale ? t`Trend may be stale` : t`Trend`}</span>
        <ChevronDown aria-hidden className={PILL_CHEVRON_CLASS} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>{t`Trend date`}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={stale ? STALE : ANY}
          onValueChange={(next) => onChange(next === STALE ? true : undefined)}
        >
          <DropdownMenuRadioItem value={ANY}>{t`Any`}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value={STALE}>{t`May be stale`}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <p className="m-0 px-2 py-1.5 text-xs text-ink-2">
          {t`A trend date over ${days} days old: the sound or style may have moved on.`}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
