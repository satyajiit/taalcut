// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: General's views (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system:
 *   DESIGN.md v0.6 + UX4 (the kit's ViewLinks)
 * the four pages behind Settings' first row, as macOS keeps About and Software Update under General: General itself
 *   (language, appearance, sounds, Kaatu), Updates, This Mac and About. Each is its own page with its own URL; the
 *   sidebar's General stays current on all four.
 * states: the kit's ViewLink: default · hover · focus-visible · active · current; disabled, loading, error, success:
 *   n/a (links to pages) */
import { useLingui } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { SETTINGS_ICONS } from '../settings-icons';
import { SettingsViews } from '../settings-page';

export type GeneralView = 'general' | 'updates' | 'this-mac' | 'about';

export function GeneralViews({ current }: { current: GeneralView }) {
  const { t } = useLingui();
  return (
    <SettingsViews
      label={t`General`}
      current={current}
      views={[
        {
          id: 'general',
          label: t`General`,
          icon: SETTINGS_ICONS.general,
          link: <Link to="/settings/general">{t`General`}</Link>,
        },
        {
          id: 'updates',
          label: t`Updates`,
          icon: SETTINGS_ICONS.updates,
          link: <Link to="/settings/updates">{t`Updates`}</Link>,
        },
        {
          id: 'this-mac',
          label: t`This Mac`,
          icon: SETTINGS_ICONS.thisMac,
          link: <Link to="/settings/this-mac">{t`This Mac`}</Link>,
        },
        {
          id: 'about',
          label: t`About`,
          icon: SETTINGS_ICONS.about,
          link: <Link to="/settings/about">{t`About`}</Link>,
        },
      ]}
    />
  );
}
