// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute, redirect } from '@tanstack/react-router';
import { parseHubSearch, type HubSearch } from '../../../../features/templates/hub/hub-search';

/**
 * The template hub's old address (P3-B12). The hub is Start from… › Community now (UX4 tpl); links in chats and
 * cards still say /templates/hub, so it lands there with its search.
 */
export const Route = createFileRoute('/_shell/templates/hub/')({
  validateSearch: (search: Record<string, unknown>): HubSearch => parseHubSearch(search),
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/templates/start/community', search, replace: true });
  },
});
