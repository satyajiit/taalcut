// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · page: settings sources · system: DESIGN.md v0.6 + UX4 · the settings page frame and its PageSections
 * (features/settings/sources) */
import { Trans, useLingui } from '@lingui/react/macro';
import { createFileRoute } from '@tanstack/react-router';
import { SettingsPage } from '../../features/settings/settings-page';
import { SourcesSettings } from '../../features/settings/sources/sources-settings';

export const Route = createFileRoute('/settings/sources')({
  component: Sources,
});

function Sources() {
  const { t } = useLingui();
  return (
    <SettingsPage
      title={t`Sources`}
      description={<Trans>Where Taalcut finds your videos, and how each place is doing.</Trans>}
    >
      <SourcesSettings />
    </SettingsPage>
  );
}
