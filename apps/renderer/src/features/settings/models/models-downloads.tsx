// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · page: Settings › Models › Downloads (UX4) · genre: atmospheric studio app (chrome modern-minimal) ·
 *   system: DESIGN.md v0.6 + UX4
 * everything this Mac needs to run the jobs, downloading as one, with its controls and each job's parts and
 *   licences (features/downloads/models-on-this-mac.tsx: its states). Main's "couldn't download" notification opens
 *   here at a job's row (#downloads-<job>) or at the whole download (#downloads).
 * states: the downloads section's (loading bones, error, downloading, paused, failed, done) */
import { Trans, useLingui } from '@lingui/react/macro';
import { ModelsOnThisMac } from '../../downloads/models-on-this-mac';
import { SettingsPage } from '../settings-page';
import { ModelsViews } from './models-views';

export function ModelsDownloads() {
  const { t } = useLingui();
  return (
    <SettingsPage
      title={t`Models`}
      detail={t`Downloads`}
      views={<ModelsViews current="downloads" />}
      description={<Trans>Which AI does each job, and how hard it thinks.</Trans>}
    >
      <ModelsOnThisMac />
    </SettingsPage>
  );
}
