// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: other things that use the internet · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.6 + UX4 · read-only SettingRows: name and what it sends, then whether it is on and whether
 * Local only allows it. On Privacy › Sharing it sits under Help improve Taalcut, so the two flows whose switches are
 * right above it (usage counts, crash reports) aren't listed a second time (critique A: three names for one switch).
 * states: on · off · off while Local only is on · allowed with Local only */

import { Trans, useLingui } from '@lingui/react/macro';
import type { PrivacyOverview } from '@taalcut/core';
import { Badge } from '@taalcut/ui';
import { formatDay } from '../../shared/format';
import { FLOW_LABELS } from './privacy-labels';
import { SettingRow, SettingRows } from '../rows';

type FlowRow = PrivacyOverview['other'][number];

function Status({ row, localOnly }: { row: FlowRow; localOnly: boolean }) {
  const { i18n } = useLingui();
  const last = row.lastAt ? formatDay(i18n, row.lastAt) : null;
  if (!row.enabled)
    return (
      <Badge tone="neutral">
        {localOnly && !row.allowedLocalOnly ? <Trans>Off while Local only is on</Trans> : <Trans>Off</Trans>}
      </Badge>
    );
  if (localOnly && row.allowedLocalOnly)
    return (
      <Badge tone="you">
        <Trans>On, allowed with Local only</Trans>
      </Badge>
    );
  if (!last || !row.lastAt)
    return (
      <Badge tone="neutral">
        <Trans>On</Trans>
      </Badge>
    );
  return (
    <Badge tone="neutral">
      <Trans>
        On, last{' '}
        <time dateTime={new Date(row.lastAt).toISOString()} className="font-sans">
          {last}
        </time>
      </Trans>
    </Badge>
  );
}

/** The flows Help improve Taalcut switches: said once, by their switches. */
const SWITCHED: ReadonlySet<FlowRow['flow']> = new Set<FlowRow['flow']>(['telemetry', 'crash-reports']);

/** Everything else that uses the network (P2-X2), and whether Local only allows it. */
export function OtherFlows({ overview }: { overview: PrivacyOverview }) {
  const { t, i18n } = useLingui();
  return (
    <SettingRows aria-label={t`Other things that use the internet`}>
      {overview.other
        .filter((row) => !SWITCHED.has(row.flow))
        .map((row) => {
          const { more } = FLOW_LABELS[row.flow];
          return (
            <SettingRow
              key={row.flow}
              data-flow={row.flow}
              data-enabled={row.enabled}
              title={i18n._(FLOW_LABELS[row.flow].name)}
              description={
                <>
                  {i18n._(FLOW_LABELS[row.flow].sends)}
                  {more ? <span className="block">{i18n._(more)}</span> : null}
                </>
              }
              status={<Status row={row} localOnly={overview.localOnly} />}
            />
          );
        })}
    </SettingRows>
  );
}
