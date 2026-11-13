// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: filter pill · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * a hairline pill naming the filter; set, it shows the choice on the selection wash (marigold soft) with a strong edge
 * states: default · hover (hover surface) · focus (base ring) · active (pressed surface) · disabled (ink-disabled,
 *   not-allowed) · open (pressed surface, chevron turned) · set (selection wash) · loading/error/success n/a: the
 *   count and the grid answer for the filter
 * the menu opens at once (DESIGN.md: menus open instantly)
 * LIB1-FIND: a pill whose choices come from the library stays in the row with none (nothing moves when its read
 *   lands); its menu then says how it fills (`empty`, quiet ink-2 under Any, and the menu's description)
 */
import { useLingui } from '@lingui/react/macro';
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@taalcut/ui';
import { ChevronDown } from 'lucide-react';
import { useId, type ReactNode } from 'react';

export interface FilterOption<V extends string> {
  value: V;
  label: string;
  /** Data, not the catalogue's words (a source's name, a city, Intl's name for a country): never translated. */
  raw?: boolean;
  /** One level in, under the option before it (a city under its country). */
  inset?: boolean;
}

export interface FilterPillProps<V extends string> {
  /** The filter's name: Shape, Length… */
  label: string;
  value: V | undefined;
  options: readonly FilterOption<V>[];
  onChange: (value: V | undefined) => void;
  /** "Any" clears it; a sort has no "Any". */
  clearable?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  /** With no choices, what the menu says about how they come (once the library has answered). */
  empty?: string;
}

const ANY = '__any';

export function FilterPill<V extends string>({
  label,
  value,
  options,
  onChange,
  clearable = true,
  disabled,
  icon,
  empty,
}: FilterPillProps<V>) {
  const { t } = useLingui();
  const noteId = useId();
  const note = options.length === 0 && empty ? empty : undefined;
  const chosen = options.find((option) => option.value === value);
  const set = clearable && chosen !== undefined;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        data-slot="filter-pill"
        data-set={set || undefined}
        className={cn(
          'group inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-pill border border-rule px-3 text-sm whitespace-nowrap text-ink-2',
          'transition-colors duration-(--dur-micro) ease-(--ease-out) hover:bg-hover hover:text-ink active:bg-pressed',
          'data-[state=open]:bg-pressed data-[state=open]:text-ink',
          'data-[set]:border-primary-strong data-[set]:bg-selected data-[set]:text-ink',
          'disabled:cursor-not-allowed disabled:text-ink-disabled disabled:hover:bg-transparent',
          '[&_svg]:size-3.5 [&_svg]:shrink-0',
        )}
      >
        {icon}
        {set && chosen.raw ? (
          <span translate="no" data-user-content className="max-w-40 truncate font-medium">
            {chosen.label}
          </span>
        ) : (
          <span className={cn(set && 'font-medium')}>
            {chosen && (set || !clearable) ? chosen.label : label}
          </span>
        )}
        <ChevronDown
          aria-hidden
          className="text-ink-3 transition-transform duration-(--dur-micro) ease-(--ease-out) group-data-[state=open]:rotate-180"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48" aria-describedby={note ? noteId : undefined}>
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value ?? ANY}
          onValueChange={(next) => onChange(next === ANY ? undefined : (next as V))}
        >
          {clearable ? (
            <>
              <DropdownMenuRadioItem value={ANY}>{t`Any`}</DropdownMenuRadioItem>
              {/* Inside the radio group, the menu's edge-to-edge rule would stick out of the group: it spans the group. */}
              <DropdownMenuSeparator className="mx-0" />
            </>
          ) : null}
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              className={cn(option.inset && 'pl-12')}
            >
              {option.raw ? (
                <span translate="no" data-user-content>
                  {option.label}
                </span>
              ) : (
                option.label
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {note ? (
          <p
            id={noteId}
            data-slot="filter-empty"
            className="max-w-56 px-2 py-1.5 text-sm text-pretty text-ink-2"
          >
            {note}
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
