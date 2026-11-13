// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { ImportSessionPage } from '../../../../features/library/imports/import-session';
import { routeId } from '../../../../shell/route-id';
export const Route = createFileRoute('/_shell/library/imports/$sessionId')({
  params: { parse: ({ sessionId }) => ({ sessionId: routeId<'ImportSession'>(sessionId) }) },
  component: Session,
});
function Session() {
  return <ImportSessionPage sessionId={Route.useParams().sessionId} />;
}
