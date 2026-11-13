// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { PrivacySettings } from '../../../features/settings/privacy/privacy-settings';

export const Route = createFileRoute('/settings/privacy/')({
  // The crumb lives on the index, the route the shell's crumbs find at /settings/privacy ("Privacy › Sharing").
  staticData: { crumb: msg`Privacy` },
  component: PrivacySettings,
});
