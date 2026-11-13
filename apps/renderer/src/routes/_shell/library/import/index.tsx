// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { ImportChooser } from '../../../../features/library/imports/import-chooser';
export const Route = createFileRoute('/_shell/library/import/')({
  staticData: { crumb: msg`Import` },
  component: ImportChooser,
});
