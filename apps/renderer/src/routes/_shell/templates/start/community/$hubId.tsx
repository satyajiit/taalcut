// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { HubDetailPage } from '../../../../../features/templates/hub/hub-detail-page';
import { routeId } from '../../../../../shell/route-id';

/** One community template (P3-B12, P3-V8, UX4 tpl): its preview, slots, facts, Use for a video, Copy, Rate, Report. */
export const Route = createFileRoute('/_shell/templates/start/community/$hubId')({
  params: {
    parse: ({ hubId }) => ({ hubId: routeId<'HubTemplate'>(hubId) }),
    stringify: ({ hubId }) => ({ hubId }),
  },
  component: CommunityTemplate,
});

function CommunityTemplate() {
  const { hubId } = Route.useParams();
  return <HubDetailPage hubId={hubId} />;
}
