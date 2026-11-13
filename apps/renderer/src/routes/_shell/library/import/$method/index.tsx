// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { ImportConnect } from '../../../../../features/library/imports/import-connect';
import { routeMethod } from '../../../../../features/library/imports/import-words';
export const Route = createFileRoute('/_shell/library/import/$method/')({
  params: { parse: ({ method }) => ({ method: routeMethod(method) }) },
  component: Connect,
});
function Connect() {
  return <ImportConnect method={Route.useParams().method} />;
}
