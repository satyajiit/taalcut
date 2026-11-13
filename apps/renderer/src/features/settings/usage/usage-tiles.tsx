// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: Usage › totals (four stat tiles) · genre: atmospheric studio app (chrome modern-minimal)
 *   · system: DESIGN.md v0.6 + UX4
 * one hairline strip of four cells, not four cards: a sentence-case label in ink-2, the value in type-section with
 *   tabular figures (Onest: it sits still), one quiet line of meta under it in ink-3. Spent · Requests (and how many
 *   ran on this Mac) · Sent from this Mac (the bytes Privacy counts) · Other units (voice characters, audio seconds,
 *   images: each only when non-zero). No deltas: there is no earlier period to compare honestly.
 * motion: a new period or filter ticks each number from the old value to the new one (the kit's NumberTicker, the
 *   motion grammar's Count); the first numbers show at once; reduced motion: at once
 * states: default · loading (stale: dimmed after 150 ms by StaleContent; first load: the page's skeleton) · error
 *   (the page's) · success (the numbers) · empty (zeros, said plainly) · hover/focus/active/disabled (n/a)
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { UsageSummary } from '@taalcut/core';
import { NumberTicker, StaleContent } from '@taalcut/ui';
import type { ReactNode } from 'react';
import { formatBytes } from '../../shared/format';
import { moneyShort, OTHER_UNITS, unitAmount } from './usage-words';

function Tile({ label, value, note }: { label: ReactNode; value: ReactNode; note?: ReactNode }) {
  return (
    <div data-slot="stat-tile" className="flex min-w-0 flex-col gap-1 bg-raised px-4 py-3.5">
      <dt className="type-body text-ink-2">{label}</dt>
      <dd className="m-0 flex flex-col gap-0.5">
        <span className="type-section text-ink tabular-nums">{value}</span>
        {note ? <span className="type-meta text-ink-3">{note}</span> : null}
      </dd>
    </div>
  );
}

export function UsageTiles({ totals, stale }: { totals: UsageSummary['totals']; stale: boolean }) {
  const { i18n } = useLingui();
  const units = OTHER_UNITS.filter((unit) => (totals.units[unit] ?? 0) > 0);
  const cloud = totals.calls - totals.localCalls;
  return (
    <StaleContent stale={stale} asChild>
      <dl
        data-slot="usage-totals"
        // Hairlines between the cells: the strip's rule colour showing through a 1 px gap.
        className="m-0 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-rule-subtle bg-rule-subtle sm:grid-cols-2 xl:grid-cols-4"
      >
        <Tile
          label={<Trans>Spent</Trans>}
          value={<NumberTicker value={totals.costUsd} format={(usd) => moneyShort(i18n, usd)} />}
          note={<Plural value={cloud} one="On # request to the cloud" other="On # requests to the cloud" />}
        />
        <Tile
          label={<Trans>Requests</Trans>}
          value={<NumberTicker value={totals.calls} format={(calls) => i18n.number(Math.round(calls))} />}
          note={
            <Plural
              value={totals.localCalls}
              _0="None ran on this Mac"
              one="# on this Mac, free"
              other="# on this Mac, free"
            />
          }
        />
        <Tile
          label={<Trans>Sent from this Mac</Trans>}
          value={
            <NumberTicker value={totals.bytesSent} format={(bytes) => formatBytes(i18n, Math.round(bytes))} />
          }
          note={<Trans>Frames, audio and text sent to models</Trans>}
        />
        <Tile
          label={<Trans>Other units</Trans>}
          value={
            units.length > 0 ? (
              <span className="flex flex-col type-body text-ink">
                {units.map((unit) => (
                  <span key={unit}>{unitAmount(i18n, unit, totals.units[unit] ?? 0)}</span>
                ))}
              </span>
            ) : (
              <span className="type-body text-ink-2">
                <Trans>Only tokens</Trans>
              </span>
            )
          }
          note={<Trans>What voice, speech and images are billed in</Trans>}
        />
      </dl>
    </StaleContent>
  );
}
