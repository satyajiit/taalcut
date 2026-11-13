// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: a usage breakdown table's header and row · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: DESIGN.md v0.3
 * a sortable header (a quiet uppercase button with the arrow of its order, aria-sort on the cell) and a row: the
 *   name as a toggle that filters the page, requests, what it used, cost, and its share as a thin neutral bar with
 *   the percent.
 * states: default · hover (row wash; header and name ink) · focus (base ring) · active (the filtered row:
 *   selection wash, a check, aria-pressed; the sorted header in ink-2) · disabled (a fixed row: plain text)
 *   · loading/error (the table's) · success (the filter is the answer)
 */
import type { I18n } from '@lingui/core';
import { useLingui } from '@lingui/react/macro';
import { cn } from '@taalcut/ui';
import { ArrowDown, ArrowUp, Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatPercent } from '../../shared/format';
import { moneyShort } from './usage-words';

/** One row of a breakdown: a job, a provider or a project, with what it used and cost. */
export interface BreakdownRow<K extends string> {
  readonly key: K;
  readonly name: ReactNode;
  /** The name as text, for sorting by name. */
  readonly sortName: string;
  /** The name is a product or provider id the catalogue doesn't know, or the person's own (no translation). */
  readonly asWritten?: boolean;
  readonly calls: number;
  readonly costUsd: number;
  /** What it used, in words: tokens or billed units. */
  readonly used: ReactNode;
  /** Under the name: a model id, a budget meter. */
  readonly detail?: ReactNode;
  /** This row can't filter the page (e.g. calls outside any project). */
  readonly fixed?: boolean;
}

export type SortKey = 'name' | 'calls' | 'cost';
export interface Sort {
  readonly by: SortKey;
  readonly down: boolean;
}

// type-caption in its own case: an uppercase header does nothing for Hindi.
export const HEAD = 'bg-well px-3 py-2 type-caption whitespace-nowrap text-ink-3';
const CELL = 'border-t border-rule-subtle px-3 py-2.5 align-top';

/** The rows in the table's order: cost breaks its ties by requests; names sort in the page's language. */
export function sortRows<K extends string>(rows: readonly BreakdownRow<K>[], sort: Sort, i18n: I18n) {
  const order = (a: BreakdownRow<K>, b: BreakdownRow<K>) => {
    if (sort.by === 'calls') return a.calls - b.calls;
    if (sort.by === 'cost') return a.costUsd - b.costUsd || a.calls - b.calls;
    return a.sortName.localeCompare(b.sortName, i18n.locale);
  };
  return [...rows].sort((a, b) => (sort.down ? -order(a, b) : order(a, b)));
}

export function SortHeader({
  by,
  text,
  end = false,
  sort,
  onSort,
}: {
  by: SortKey;
  text: string;
  /** A number column: right-aligned. */
  end?: boolean;
  sort: Sort;
  onSort: (sort: Sort) => void;
}) {
  const current = sort.by === by;
  const Arrow = sort.down ? ArrowDown : ArrowUp;
  const ariaSort = !current ? 'none' : sort.down ? 'descending' : 'ascending';
  return (
    <th scope="col" aria-sort={ariaSort} className={cn(HEAD, end && 'text-right')}>
      <button
        type="button"
        // A new column sorts biggest first, names A to Z; the same one again flips.
        onClick={() => onSort({ by, down: current ? !sort.down : by !== 'name' })}
        className={cn(
          'inline-flex cursor-pointer items-center gap-1 rounded-sm uppercase hover:text-ink',
          current && 'text-ink-2',
        )}
      >
        {text}
        {current ? <Arrow aria-hidden className="size-3" /> : null}
      </button>
    </th>
  );
}

function NameCell<K extends string>({
  row,
  on,
  onSelect,
}: {
  row: BreakdownRow<K>;
  on: boolean;
  onSelect: (key: K | null) => void;
}) {
  return (
    <td className={cn(CELL, 'min-w-36')}>
      {row.fixed ? (
        <span className="block font-medium text-ink">{row.name}</span>
      ) : (
        <button
          type="button"
          aria-pressed={on}
          onClick={() => onSelect(on ? null : row.key)}
          translate={row.asWritten ? 'no' : undefined}
          className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-sm text-left font-medium text-ink underline-offset-2 hover:underline"
        >
          {on ? <Check aria-hidden className="size-3.5 shrink-0 text-primary-strong" /> : null}
          <span className="min-w-0 break-words">{row.name}</span>
        </button>
      )}
      {row.detail ? <div className="mt-1.5">{row.detail}</div> : null}
    </td>
  );
}

export function BreakdownRowView<K extends string>({
  row,
  total,
  on,
  onSelect,
}: {
  row: BreakdownRow<K>;
  /** The period's spend (the share's whole). */
  total: number;
  /** The page is filtered to this row. */
  on: boolean;
  onSelect: (key: K | null) => void;
}) {
  const { i18n } = useLingui();
  const share = total > 0 ? row.costUsd / total : 0;
  return (
    <tr data-row={row.key} className={cn('transition-colors', on ? 'bg-selection/60' : 'hover:bg-hover/50')}>
      <NameCell row={row} on={on} onSelect={onSelect} />
      <td className={cn(CELL, 'text-right text-ink-2')}>{i18n.number(row.calls)}</td>
      <td className={cn(CELL, 'text-right text-ink-2')}>{row.used}</td>
      <td className={cn(CELL, 'text-right font-medium whitespace-nowrap text-ink')}>
        {moneyShort(i18n, row.costUsd)}
      </td>
      <td className={CELL}>
        <span className="flex items-center gap-2">
          <span aria-hidden className="relative h-1 flex-1 overflow-hidden rounded-pill bg-hover">
            <span
              className="absolute inset-0 origin-left rounded-pill bg-ink-3"
              style={{ transform: `scaleX(${share})` }}
            />
          </span>
          <span className="w-10 text-right type-meta text-ink-2 tabular-nums">
            {formatPercent(i18n, share)}
          </span>
        </span>
      </td>
    </tr>
  );
}
