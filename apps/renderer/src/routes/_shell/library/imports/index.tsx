// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { ImportsPage } from '../../../../features/library/imports/imports-page';
export const Route = createFileRoute('/_shell/library/imports/')({
  staticData: { crumb: msg`Imports` },
  validateSearch: (search: Record<string, unknown>): { phones?: boolean } => ({
    phones: search.phones === true || search.phones === 'true',
  }),
  component: Imports,
});
function Imports() {
  return <ImportsPage phones={Route.useSearch().phones} />;
}
