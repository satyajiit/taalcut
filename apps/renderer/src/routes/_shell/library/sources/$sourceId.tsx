// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { LibrarySourceDetail } from '../../../../features/library/imports/library-sources';
import { routeId } from '../../../../shell/route-id';
export const Route = createFileRoute('/_shell/library/sources/$sourceId')({
  params: { parse: ({ sourceId }) => ({ sourceId: routeId<'Source'>(sourceId) }) },
  component: Source,
});
function Source() {
  return <LibrarySourceDetail sourceId={Route.useParams().sourceId} />;
}
