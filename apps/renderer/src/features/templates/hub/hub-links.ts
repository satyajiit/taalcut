// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CardLink } from '@taalcut/ui';
import type { useNavigate } from '@tanstack/react-router';

type Navigate = ReturnType<typeof useNavigate>;

/** A card's link into the hub (P3-B12): a template's hub page, or the browse page searched for `query`. */
export function hubLink(navigate: Navigate, link: Extract<CardLink, { to: 'hub' }>): void {
  if (link.hubId) {
    void navigate({ to: '/templates/start/community/$hubId', params: { hubId: link.hubId } });
    return;
  }
  void navigate({ to: '/templates/start/community', search: link.query ? { q: link.query.slice(0, 200) } : {} });
}
