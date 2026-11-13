// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { LibrarySources } from '../../../../features/library/imports/library-sources';
export const Route = createFileRoute('/_shell/library/sources/')({
  staticData: { crumb: msg`Sources` },
  component: LibrarySources,
});
