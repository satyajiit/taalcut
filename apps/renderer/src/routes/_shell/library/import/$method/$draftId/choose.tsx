// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { ImportChoose } from '../../../../../../features/library/imports/import-choose';
import { routeMethod } from '../../../../../../features/library/imports/import-words';
import { routeId } from '../../../../../../shell/route-id';
export const Route = createFileRoute('/_shell/library/import/$method/$draftId/choose')({
  params: {
    parse: ({ method, draftId }) => ({
      method: routeMethod(method),
      draftId: routeId<'ImportDraft'>(draftId),
    }),
  },
  component: Screen,
});
function Screen() {
  return <ImportChoose {...Route.useParams()} />;
}
