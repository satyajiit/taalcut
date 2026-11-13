// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: sort pill (Templates, the hub) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * the filter pill's look for the order: the pill names the sort with an arrow for its direction; the menu lists the
 *   sorts, then (where the list can turn round) the two directions in words ("Newest first", "A to Z"). One pill
 *   instead of a sort and a separate direction button, so the filter row fits one line at 1280 (UX1 M10)
 * states: default · hover (hover surface) · focus-visible (base ring) · active (pressed surface) · open (pressed,
 *   chevron turned) · disabled n/a (there is always an order) · loading/error/success n/a: the list answers for it
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
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDown } from 'lucide-react';
import { PILL_CHEVRON_CLASS, PILL_CLASS } from './pill';

export type SortDirection = 'asc' | 'desc';

export interface SortPillProps<V extends string> {
  readonly value: V;
  readonly options: readonly { readonly value: V; readonly label: string }[];
  readonly onChange: (value: V) => void;
  /** The direction and its two words for the sort in effect; absent where the order can't turn round. */
  readonly direction?: {
    readonly value: SortDirection;
    readonly words: Readonly<Record<SortDirection, string>>;
    readonly onChange: (value: SortDirection) => void;
  };
}

const isDirection = (value: string): value is SortDirection => value === 'asc' || value === 'desc';

export function SortPill<V extends string>({ value, options, onChange, direction }: SortPillProps<V>) {
  const { t } = useLingui();
  const chosen = options.find((option) => option.value === value);
  const Arrow = direction?.value === 'asc' ? ArrowUpNarrowWide : ArrowDownWideNarrow;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger data-slot="sort-pill" className={PILL_CLASS}>
        <Arrow aria-hidden />
        <span className="sr-only">{t`Sort:`}</span>
        <span>{chosen?.label}</span>
        {direction ? <span className="sr-only">{direction.words[direction.value]}</span> : null}
        <ChevronDown aria-hidden className={PILL_CHEVRON_CLASS} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel>{t`Sort by`}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            const picked = options.find((option) => option.value === next);
            if (picked) onChange(picked.value);
          }}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {direction ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t`Order`}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={direction.value}
              onValueChange={(next) => {
                if (isDirection(next)) direction.onChange(next);
              }}
            >
              <DropdownMenuRadioItem value="desc">{direction.words.desc}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="asc">{direction.words.asc}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
