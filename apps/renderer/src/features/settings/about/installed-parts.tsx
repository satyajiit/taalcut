// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: Settings › General › This Mac › Installed parts (UX4, out of About) · genre: atmospheric
 *   studio app (chrome modern-minimal) · system: DESIGN.md v0.6 + UX4 (SettingRow)
 * one row per part Taalcut downloaded: its name and version, what it is for and its size (ink-2), and its status at
 *   the row's end; only a status that asks for something takes a colour (a chip). The part's licence is on About's
 *   one list of licences now, so these rows stay about what is on this Mac. A part with terms of its own (NVIDIA's)
 *   keeps its ownership line.
 * states: installed · downloading (a spinner and the percent) · waiting · paused · not installed · update available
 *   (warning chip) · failed (danger chip) */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import type { Component } from '@taalcut/core';
import { Badge, Chip, PageSection } from '@taalcut/ui';
import { LoaderCircle } from 'lucide-react';
import { OwnershipLine } from '../../gpu-setup/ownership-line';
import { hasTerms } from '../../gpu-setup/nvidia-terms';
import { formatBytes, formatPercent } from '../../shared/format';
import { translateKey } from '../model-messages';
import { SettingRow, SettingRows } from '../rows';
import { SETTINGS_ICONS } from '../settings-icons';

const JOB = msg`another job`;

/** Status words; only the ones that ask for something get a colour (a chip). */
const STATUS: Record<Component['status'], { label: MessageDescriptor; tone?: 'warning' | 'danger' }> = {
  installed: { label: msg`Installed` },
  downloading: { label: msg`Downloading` },
  // UX2-DOWNLOADER: in the download of everything this Mac needs, waiting for a lane, or paused by the person.
  queued: { label: msg`Waiting to download` },
  paused: { label: msg`Paused` },
  'not-installed': { label: msg`Not installed` },
  'update-available': { label: msg`Update available`, tone: 'warning' },
  failed: { label: msg`Download failed`, tone: 'danger' },
};

function ComponentStatus({ component }: { component: Component }) {
  const { i18n } = useLingui();
  const status = STATUS[component.status];
  if (status.tone) return <Chip tone={status.tone}>{i18n._(status.label)}</Chip>;
  if (component.status === 'downloading') {
    // A background job: neutral, with a spinner (DESIGN.md v0.2, Running status).
    const percent = component.progress === undefined ? null : formatPercent(i18n, component.progress);
    return (
      <span className="inline-flex items-center gap-1.5 type-meta text-ink-2 tabular-nums">
        <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
        {percent === null ? i18n._(status.label) : <Trans>Downloading {percent}</Trans>}
      </span>
    );
  }
  return <Badge tone="neutral">{i18n._(status.label)}</Badge>;
}

/** What jobs a part serves, as a unit list ("Agent, Seeing your clips"): no conjunction for the pseudo-locale. */
export function useJobsOf(component: Component): string {
  const { i18n } = useLingui();
  return new Intl.ListFormat(i18n.locale, { type: 'unit' }).format(
    component.usedBy.map((m) => translateKey(i18n, `models.module.${m}.label`, JOB)),
  );
}

function PartRow({ component: c }: { component: Component }) {
  const { i18n } = useLingui();
  const jobs = useJobsOf(c);
  const size = formatBytes(i18n, c.sizeBytes);
  return (
    <SettingRow
      data-component={c.id}
      title={
        <span translate="no">
          {c.name} <span className="type-meta text-ink-3">{c.version}</span>
        </span>
      }
      description={
        <>
          {jobs ? <Trans>Used for {jobs}</Trans> : <Trans>Used by Taalcut itself</Trans>} ·{' '}
          <span className="tabular-nums">{size}</span>
        </>
      }
      status={<ComponentStatus component={c} />}
    >
      {hasTerms(c) ? <OwnershipLine component={c} /> : null}
    </SettingRow>
  );
}

export function InstalledParts({ components }: { components: readonly Component[] }) {
  const { t } = useLingui();
  return (
    <PageSection
      title={<Trans>Installed parts</Trans>}
      icon={SETTINGS_ICONS.parts}
      description={<Trans>Tools and models Taalcut downloaded to run on this Mac.</Trans>}
    >
      <SettingRows aria-label={t`Installed parts`}>
        {components.map((c) => (
          <PartRow key={c.id} component={c} />
        ))}
      </SettingRows>
    </PageSection>
  );
}
