// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: Privacy's views (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system:
 *   DESIGN.md v0.6 + UX4 (the kit's ViewLinks)
 * Privacy as two questions instead of one long scroll: what leaves this Mac for your work (Local only, each job,
 *   the uploads you always allow), and what Taalcut itself shares (usage counts, crash reports, update checks and
 *   the rest that uses the internet). Each its own page.
 * states: the kit's ViewLink: default · hover · focus-visible · active · current */
import { useLingui } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { SETTINGS_ICONS } from '../settings-icons';
import { SettingsViews } from '../settings-page';

export function PrivacyViews({ current }: { current: 'leaves' | 'sharing' }) {
  const { t } = useLingui();
  return (
    <SettingsViews
      label={t`Privacy`}
      current={current}
      views={[
        {
          id: 'leaves',
          label: t`What leaves`,
          icon: SETTINGS_ICONS.whatLeaves,
          link: <Link to="/settings/privacy">{t`What leaves`}</Link>,
        },
        {
          id: 'sharing',
          label: t`Sharing`,
          icon: SETTINGS_ICONS.sharing,
          link: <Link to="/settings/privacy/sharing">{t`Sharing`}</Link>,
        },
      ]}
    />
  );
}
