// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { PluginsPage } from '../../../features/settings/plugins/plugins-page';

export const Route = createFileRoute('/settings/plugins/')({
  staticData: { crumb: msg`Plugins` },
  component: PluginsPage,
});
