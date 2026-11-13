// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: Settings › General › About › Licences (UX4) · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: DESIGN.md v0.6 + UX4 (SettingRow)
 * one list of every licence, where About used to scatter them through twenty part rows (critique A: 28 "Licence"
 *   links across Models and About): Taalcut's own first, the GeoNames places built into it (LIB1-PLACE), then each
 *   part Taalcut downloaded with its SPDX id at the
 *   row's end and, when its notice is on this Mac, the link that opens it (downloads/licence-link.tsx: its states).
 *   A notice that didn't open says why under its row.
 * states: default · a part with no notice here (no link) · opening (the link's progress) · failed (the cause and
 *   Try again under the row) · loading (the page's skeleton) · error (LoadError, Try again) */
import { Trans, useLingui } from '@lingui/react/macro';
import type { Component } from '@taalcut/core';
import { PageSection } from '@taalcut/ui';
import { LicenceLink, NoticeError, useNoticeOpener } from '../../downloads/licence-link';
import { SettingRow, SettingRows } from '../rows';
import { SETTINGS_ICONS } from '../settings-icons';
import { useJobsOf } from './installed-parts';

/** Taalcut's own licence, as the repository names it (an SPDX id: never translated). */
const TAALCUT_LICENCE = 'AGPL-3.0-or-later';
/** LIB1-PLACE: the GeoNames cities built into the app to name places (packages/library/data/GEONAMES-NOTICE.txt). */
const GEONAMES_LICENCE = 'CC-BY-4.0';
/** Its name and home, as GeoNames writes them: never translated. */
const GEONAMES_NAME = 'GeoNames';
const GEONAMES_SITE = 'geonames.org';

function PartLicence({ component: c }: { component: Component }) {
  const notice = useNoticeOpener();
  const jobs = useJobsOf(c);
  return (
    <SettingRow
      data-component={c.id}
      title={
        <span translate="no">
          {c.name} <span className="type-meta text-ink-3">{c.version}</span>
        </span>
      }
      description={jobs ? <Trans>Used for {jobs}</Trans> : <Trans>Used by Taalcut itself</Trans>}
      status={<span translate="no">{c.licence}</span>}
      control={c.notice ? <LicenceLink parts={[c]} label={c.name} opener={notice} /> : null}
    >
      <NoticeError opener={notice} />
    </SettingRow>
  );
}

export function LicencesSection({ components }: { components: readonly Component[] | undefined }) {
  const { t } = useLingui();
  return (
    <PageSection
      title={<Trans>Licences</Trans>}
      icon={SETTINGS_ICONS.licences}
      description={<Trans>Taalcut is free and open source, and so is every part it downloads.</Trans>}
    >
      <SettingRows aria-label={t`Licences`}>
        <SettingRow
          data-component="taalcut"
          title={<Trans>Taalcut</Trans>}
          description={<Trans>The app itself. You can read, change and share its code.</Trans>}
          status={<span translate="no">{TAALCUT_LICENCE}</span>}
        />
        <SettingRow
          data-component="geonames"
          title={<span translate="no">{GEONAMES_NAME}</span>}
          description={
            <Trans>
              The names of cities and regions Taalcut gives your clips, built into the app from{' '}
              <span translate="no">{GEONAMES_SITE}</span>.
            </Trans>
          }
          status={<span translate="no">{GEONAMES_LICENCE}</span>}
        />
        {(components ?? []).map((c) => (
          <PartLicence key={c.id} component={c} />
        ))}
      </SettingRows>
    </PageSection>
  );
}
