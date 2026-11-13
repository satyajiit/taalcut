// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: what leaves this Mac · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.6 + UX4 · one SettingRow per job: its providers' logos in a fixed slot (so every job's name
 * starts on one edge, whatever the stack's width: critique A found three), where it runs and what it sends as the
 * line, the last 30 days at the end (tabular, the text face), "See in Usage" after them. With Local only on, a job
 * that is simpler on this Mac says so in a chip beside its name (P3-B10); one that is off already says why.
 * states: default · hover/focus/active (the Usage link) · nothing sent ("Nothing sent in the last 30 days")
 * · off (Local only, or no model) · loading and error are the section's */

import { msg } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { PrivacyOverview } from '@taalcut/core';
import { ProviderLogo, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { formatBytes, formatDay } from '../../shared/format';
import { translateKey } from '../model-messages';
import { providerName } from '../providers';
import { listOf, SENT_KIND_LABELS } from './privacy-labels';
import { QualityChip, qualityFor } from './quality-labels';
import { SettingRow, SettingRows } from '../rows';

type ModuleRow = PrivacyOverview['modules'][number];

const A_JOB = msg`A job`;

function WhereItRuns({ row, localOnly }: { row: ModuleRow; localOnly: boolean }) {
  const { i18n } = useLingui();
  const providers = listOf(
    i18n,
    row.providers.map((provider) => providerName(i18n, provider) ?? provider),
  );
  const sends = listOf(
    i18n,
    row.sends.map((kind) => i18n._(SENT_KIND_LABELS[kind])),
  );
  switch (row.runsOn) {
    case 'off':
      return localOnly ? (
        <Trans>Off while Local only is on: it has no model on this Mac.</Trans>
      ) : (
        <Trans>Off: no model is chosen for it.</Trans>
      );
    case 'this-mac':
      return <Trans>Runs on this Mac. Nothing leaves.</Trans>;
    case 'cloud':
      return (
        <Trans>
          Sends {sends} to <span translate="no">{providers}</span>.
        </Trans>
      );
    case 'both':
      return (
        <Trans>
          Sends {sends} to <span translate="no">{providers}</span>, or runs on this Mac.
        </Trans>
      );
  }
}

function LastThirtyDays({ row }: { row: ModuleRow }) {
  const { i18n } = useLingui();
  const { cloudCalls, bytesSent, lastCloudAt } = row.last30Days;
  if (cloudCalls === 0) return <Trans>Nothing sent in the last 30 days</Trans>;
  const bytes = formatBytes(i18n, bytesSent);
  const last = lastCloudAt ? formatDay(i18n, lastCloudAt) : null;
  return (
    <>
      <span className="block type-label text-ink">
        <Plural value={cloudCalls} one="# request to the cloud" other="# requests to the cloud" />
      </span>
      <span className="block type-meta text-ink-3">
        <Trans>{bytes} sent</Trans>
        {last && lastCloudAt ? (
          <>
            {' · '}
            <Trans>
              last{' '}
              <time dateTime={new Date(lastCloudAt).toISOString()} className="font-sans">
                {last}
              </time>
            </Trans>
          </>
        ) : null}
      </span>
    </>
  );
}

/**
 * What leaves this Mac, per job (P2-X2): where it runs now, what it sends, and
 * the last 30 days from the CloudCall log (the rows Usage lists for that job).
 */
export function WhatLeaves({ overview }: { overview: PrivacyOverview }) {
  const { t, i18n } = useLingui();
  return (
    <SettingRows aria-label={t`What each job sends`}>
      {overview.modules.map((row) => {
        const name = translateKey(i18n, `models.module.${row.module}.label`, A_JOB);
        const logos =
          row.providers.length > 0 ? row.providers : row.runsOn === 'this-mac' ? ['on-device'] : [];
        // "Off" is said in the row's own words; only "simpler on this Mac" needs the label.
        const quality = qualityFor(overview.quality, row.module);
        const simpler = quality?.quality === 'lowerQuality' && row.runsOn !== 'off' ? quality : undefined;
        return (
          <SettingRow
            key={row.module}
            data-module={row.module}
            data-runs-on={row.runsOn}
            // One slot for one to three logos, so the names line up.
            icon={
              <span className="flex w-15 shrink-0 items-center -space-x-1.5">
                {logos.slice(0, 3).map((provider) => (
                  <ProviderLogo key={provider} provider={provider} size="sm" />
                ))}
              </span>
            }
            title={
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {name}
                {simpler ? <QualityChip quality={simpler} /> : null}
              </span>
            }
            description={<WhereItRuns row={row} localOnly={overview.localOnly} />}
            status={
              <span data-slot="last-30-days" className="block text-end">
                <LastThirtyDays row={row} />
              </span>
            }
            control={
              <Link
                to="/settings/usage/requests"
                search={{ module: row.module }}
                aria-label={t`See in Usage: ${name}`}
                className="inline-flex items-center gap-1 rounded-sm type-label-sm whitespace-nowrap text-primary-strong underline-offset-4 hover:underline active:text-ink-2"
              >
                <Trans>See in Usage</Trans>
                <VERB_ICONS.next aria-hidden className="size-3.5" />
              </Link>
            }
          />
        );
      })}
    </SettingRows>
  );
}
