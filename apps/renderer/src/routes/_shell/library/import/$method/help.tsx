// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { ImportHelp } from '../../../../../features/library/imports/import-help';
import { routeMethod } from '../../../../../features/library/imports/import-words';
export const Route = createFileRoute('/_shell/library/import/$method/help')({
  params: { parse: ({ method }) => ({ method: routeMethod(method) }) },
  component: Help,
});
function Help() {
  return <ImportHelp method={Route.useParams().method} />;
}
