// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: Models' views (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system:
 *   DESIGN.md v0.6 + UX4 (the kit's ViewLinks)
 * how Taalcut thinks (the profile, with each job's model under Advanced) and what this Mac downloads to run it, a
 *   minutes-long wait of its own that sat between the profile and Advanced. "Downloads", not "On this Mac": that is
 *   a profile's name on the other view.
 * states: the kit's ViewLink: default · hover · focus-visible · active · current */
import { useLingui } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { SETTINGS_ICONS } from '../settings-icons';
import { SettingsViews } from '../settings-page';

export function ModelsViews({ current }: { current: 'profile' | 'downloads' }) {
  const { t } = useLingui();
  return (
    <SettingsViews
      label={t`Models`}
      current={current}
      views={[
        {
          id: 'profile',
          label: t`Profile`,
          icon: SETTINGS_ICONS.profile,
          link: <Link to="/settings/models">{t`Profile`}</Link>,
        },
        {
          id: 'downloads',
          label: t`Downloads`,
          icon: SETTINGS_ICONS.downloads,
          link: <Link to="/settings/models/downloads">{t`Downloads`}</Link>,
        },
      ]}
    />
  );
}
