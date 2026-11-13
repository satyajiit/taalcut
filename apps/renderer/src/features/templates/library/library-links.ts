// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CardLink } from '@taalcut/ui';
import type { useNavigate } from '@tanstack/react-router';

type Navigate = ReturnType<typeof useNavigate>;

/** A card's link to your templates (P3-V14), opened at a folder when it names one (`/templates/folders/$folderId`). */
export function templatesLink(navigate: Navigate, link: Extract<CardLink, { to: 'templates' }>): void {
  if (link.folderId)
    void navigate({ to: '/templates/folders/$folderId', params: { folderId: link.folderId } });
  else void navigate({ to: '/templates' });
}
