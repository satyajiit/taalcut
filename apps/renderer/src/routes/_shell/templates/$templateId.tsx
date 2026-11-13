// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';
import { TemplateFrame } from '../../../features/templates/template/template-frame';
import type { TemplatePageView } from '../../../features/templates/template/template-views';
import { routeId } from '../../../shell/route-id';

/** `?version=3` reads an older version, read-only, on every page of the template; none is the latest. */
interface TemplateSearch {
  version?: number | undefined;
}

/** Each of the template's pages, so a change of version stays on the page it was made on. */
const PAGE_ROUTE = {
  overview: '/templates/$templateId',
  slots: '/templates/$templateId/slots',
  pacing: '/templates/$templateId/pacing',
  details: '/templates/$templateId/details',
} as const satisfies Record<TemplatePageView, string>;

/** Which of the template's pages is open, from the path's last part. */
function viewOf(pathname: string): TemplatePageView {
  const last = pathname.replace(/\/+$/, '').split('/').at(-1);
  return last === 'slots' || last === 'pacing' || last === 'details' ? last : 'overview';
}

/**
 * A template (UX4 tpl): its frame reads it once and shows its views; the open page is a child route (Overview,
 * Slots, Pacing, Details).
 */
export const Route = createFileRoute('/_shell/templates/$templateId')({
  params: {
    parse: ({ templateId }) => ({ templateId: routeId<'Template'>(templateId) }),
    stringify: ({ templateId }) => ({ templateId }),
  },
  validateSearch: (search: Record<string, unknown>): TemplateSearch => {
    const version = Number(search.version);
    return {
      version: Number.isInteger(version) && version >= 1 && version <= 1_000_000 ? version : undefined,
    };
  },
  component: Template,
});

function Template() {
  const { templateId } = Route.useParams();
  const { version } = Route.useSearch();
  const navigate = Route.useNavigate();
  const view = viewOf(useLocation({ select: (location) => location.pathname }));
  return (
    <TemplateFrame
      templateId={templateId}
      version={version}
      view={view}
      onVersion={(next) =>
        // Not `to: '.'`: from this layout that is the overview, and Back to the latest on Slots would leave Slots.
        void navigate({
          to: PAGE_ROUTE[view],
          params: { templateId },
          search: (prev) => ({ ...prev, version: next }),
          replace: true,
        })
      }
    >
      <Outlet />
    </TemplateFrame>
  );
}
