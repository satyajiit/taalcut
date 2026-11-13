// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: Usage › Now (limits in force) · genre: atmospheric studio app (chrome modern-minimal)
 *   · system: DESIGN.md v0.6 + UX4 (PageSection, SettingRow)
 * only while something is limited: one setting row per limit, live from usage.limitsChanged. A status glyph with
 *   the words (warning-strong only when something is actually waiting, ink-3 otherwise), the headline and when it
 *   resets, what waits in ink-2, the jobs it covers as meta; actions at the row's end: Use this Mac instead (a
 *   job's local model, undoable) and Add credit for a quota (the provider's billing page, in the browser). The
 *   relative time updates each minute.
 * states: default · hover/focus/active (Button, link) · disabled (another move running) · loading (the moving
 *   job's button spins) · error (a toast with the cause) · success (a toast with Undo; the row stays until the
 *   limit clears) · empty (no section at all)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { UsageLimit } from '@taalcut/core';
import { Button, CONCEPT_ICONS, Glyph, listOf, PageSection } from '@taalcut/ui';
import { Clock, CreditCard } from 'lucide-react';
import { useEffect, useState } from 'react';
import { limitHeadline, ResetLine, WaitingLine } from './limit-words';
import { useLocalInstead, type LocalInstead } from './use-local-instead';
import { jobName } from './usage-words';
import { BrowserLink } from '../../../chat/external-link';
import { SettingRow, SettingRows } from '../rows';

/** The clock, a tick a minute (relative times read "in 37 minutes", never seconds). */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function LimitRow({ limit, now, local }: { limit: UsageLimit; now: number; local: LocalInstead }) {
  const { i18n } = useLingui();
  const waiting = limit.waiting.length > 0;
  const Icon = limit.kind === 'quota' ? CreditCard : Clock;
  const movable = limit.modules.filter((module) => local.localFor(module) !== null);
  const jobs = listOf(
    i18n,
    limit.modules.map((module) => jobName(i18n, module)),
  );
  return (
    <SettingRow
      data-limit={limit.provider}
      icon={
        // In the glyph column every setting row keeps, warning-strong only while something waits on it.
        <span className="flex size-8 items-center justify-center">
          <Glyph icon={Icon} className={waiting ? 'text-warning-strong' : 'text-ink-3'} />
        </span>
      }
      title={
        <>
          {limitHeadline(i18n, limit)} <ResetLine limit={limit} now={now} />
        </>
      }
      description={<WaitingLine limit={limit} />}
      control={
        movable.length > 0 || (limit.kind === 'quota' && limit.billingUrl) ? (
          <span className="flex flex-wrap items-center justify-end gap-2">
            {movable.map((module) => {
              const job = jobName(i18n, module);
              return (
                <Button
                  key={module}
                  variant="secondary"
                  size="sm"
                  icon={CONCEPT_ICONS.thisComputer}
                  loading={local.pending === module}
                  disabled={local.pending !== null && local.pending !== module}
                  onClick={() => void local.move(module)}
                >
                  {movable.length > 1 ? (
                    <Trans>Run {job} on this Mac</Trans>
                  ) : (
                    <Trans>Use this Mac instead</Trans>
                  )}
                </Button>
              );
            })}
            {limit.kind === 'quota' && limit.billingUrl ? (
              <BrowserLink href={limit.billingUrl}>
                <Trans>Add credit</Trans>
              </BrowserLink>
            ) : null}
          </span>
        ) : null
      }
    >
      {jobs ? (
        <span className="type-meta text-ink-3">
          <Trans>Used for: {jobs}</Trans>
        </span>
      ) : null}
    </SettingRow>
  );
}

export function UsageNow({ limits }: { limits: readonly UsageLimit[] }) {
  const { t } = useLingui();
  const now = useMinuteClock();
  const local = useLocalInstead();
  if (limits.length === 0) return null;
  return (
    <PageSection
      title={<Trans>Now</Trans>}
      icon={CONCEPT_ICONS.waiting}
      description={
        <Trans>Limits a provider has set on Taalcut right now. Nothing is lost while they last.</Trans>
      }
    >
      <SettingRows aria-label={t`Limits in force`} data-slot="usage-now">
        {limits.map((limit) => (
          <LimitRow
            key={`${limit.provider}:${limit.model ?? ''}:${limit.kind}`}
            limit={limit}
            now={now}
            local={local}
          />
        ))}
      </SettingRows>
    </PageSection>
  );
}
