// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { TimelinePage, type TimelineSearch } from '../../../../features/timeline/timeline-page';
import { routeId, searchId } from '../../../../shell/route-id';

/**
 * The editor (P2-M7). `?timeline=` opens one variant (default: the first),
 * `?clip=` selects a clip (a chip in the chat opens it this way), `?export=1`
 * opens the export dialog. Phase 3: `?compare=<castId>` shows the variants of
 * one request side by side (P3-V3), `?panel=` opens Cleanup (P3-V9), Pacing
 * (P3-V12) or the gaps (P3-B8).
 */
const PANELS = ['cleanup', 'pacing', 'gaps'] as const;
export const Route = createFileRoute('/_shell/projects/$projectId/timeline')({
  params: {
    parse: ({ projectId }) => ({ projectId: routeId<'Project'>(projectId) }),
    stringify: ({ projectId }) => ({ projectId }),
  },
  validateSearch: (search: Record<string, unknown>): TimelineSearch => ({
    timeline: searchId<'Timeline'>(search.timeline),
    clip: searchId<'TimelineItem'>(search.clip),
    export: search.export === true || search.export === 1 || search.export === '1' ? true : undefined,
    compare: searchId<'Cast'>(search.compare),
    panel: PANELS.find((panel) => panel === search.panel),
  }),
  component: Timeline,
});

function Timeline() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <TimelinePage
      projectId={projectId}
      search={search}
      onSearch={(next) => void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true })}
    />
  );
}
