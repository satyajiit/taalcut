// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: a usage breakdown table (by job, provider or project) · genre: atmospheric studio app
 *   (chrome modern-minimal) · system: DESIGN.md v0.6 + UX4
 * a hairline table: the name (a toggle that filters the page to it), requests, what it used (tokens, or the
 *   units it was billed in), cost, and its share of the period's spend as a thin neutral bar with the percent.
 *   Headers sort (aria-sort); numbers in the text face with tabular figures. The header and row are in
 *   breakdown-table-parts.tsx.
 * states: default · hover (row wash) · focus (base ring on a name or a header) · active (the filtered row:
 *   selection wash, aria-pressed) · disabled (n/a) · loading (stale: dimmed by StaleContent) · error (the page's)
 *   · success (the filter is the answer) · empty (one line)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { cn, StaleContent } from '@taalcut/ui';
import { useState } from 'react';
import {
  BreakdownRowView,
  HEAD,
  SortHeader,
  sortRows,
  type BreakdownRow,
  type Sort,
} from './breakdown-table-parts';

export function BreakdownTable<K extends string>({
  label,
  nameHeading,
  rows,
  total,
  active,
  onSelect,
  stale = false,
}: {
  /** The table's caption, for screen readers. */
  label: string;
  nameHeading: string;
  rows: readonly BreakdownRow<K>[];
  /** The period's spend (the share's whole). */
  total: number;
  /** The row the page is filtered to. */
  active: K | null;
  onSelect: (key: K | null) => void;
  stale?: boolean;
}) {
  const { t, i18n } = useLingui();
  const [sort, setSort] = useState<Sort>({ by: 'cost', down: true });
  const sorted = sortRows(rows, sort, i18n);

  return (
    <StaleContent stale={stale} asChild>
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        data-scroll-x
        className="overflow-x-auto rounded-lg border border-rule-subtle bg-raised scrollbar-thin"
      >
        <table className="w-full min-w-[30rem] border-collapse text-left type-data">
          <caption className="sr-only">
            {label}. <Trans>Choose a name to see only its numbers.</Trans>
          </caption>
          <thead>
            <tr>
              <SortHeader by="name" text={nameHeading} sort={sort} onSort={setSort} />
              <SortHeader by="calls" text={t`Requests`} end sort={sort} onSort={setSort} />
              <th scope="col" className={cn(HEAD, 'text-right')}>
                {t`Used`}
              </th>
              <SortHeader by="cost" text={t`Cost`} end sort={sort} onSort={setSort} />
              <th scope="col" className={cn(HEAD, 'w-36')}>
                {t`Share`}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <BreakdownRowView
                key={row.key}
                row={row}
                total={total}
                on={active === row.key}
                onSelect={onSelect}
              />
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className="m-0 border-t border-rule-subtle px-3 py-5 type-body text-ink-2">
            <Trans>Nothing in this period.</Trans>
          </p>
        ) : null}
      </div>
    </StaleContent>
  );
}
