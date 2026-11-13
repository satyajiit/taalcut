// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CardLink } from '@taalcut/ui';
import type { useNavigate } from '@tanstack/react-router';
import { hubLink } from '../features/templates/hub/hub-links';
import { templatesLink } from '../features/templates/library/library-links';

type Navigate = ReturnType<typeof useNavigate>;

/** A Settings section's link: External agents opens at the session an approval came from (`?session=<id>`). */
function settingsLink(navigate: Navigate, link: Extract<CardLink, { to: 'settings' }>): void {
  const session = link.section === 'external-agents' ? link.sessionId : undefined;
  void navigate({ to: `/settings/${link.section}`, ...(session ? { search: { session } } : {}) });
}

/** Where a card's link goes: every CardLink is a route, the same from the chat, the timeline's chat and /dev/kit. */
export function navigateCardLink(navigate: Navigate, link: CardLink): void {
  switch (link.to) {
    case 'template':
      return void navigate({ to: '/templates/$templateId', params: { templateId: link.templateId } });
    case 'library':
      return void navigate({ to: '/library', search: link.filter ? { filter: link.filter } : {} });
    case 'phone':
      return void navigate({ to: '/library/phone' });
    case 'renders':
      return void navigate({ to: '/renders' });
    case 'settings':
      return settingsLink(navigate, link);
    case 'timeline':
      return void navigate({
        to: '/projects/$projectId/timeline',
        params: { projectId: link.projectId },
        search: {
          ...(link.timelineId ? { timeline: link.timelineId } : {}),
          ...(link.clipId ? { clip: link.clipId } : {}),
          ...(link.exportDialog ? { export: true as const } : {}),
          ...(link.compare ? { compare: link.compare } : {}),
          ...(link.panel ? { panel: link.panel } : {}),
        },
      });
    case 'hub':
      return hubLink(navigate, link);
    case 'templates':
      return templatesLink(navigate, link);
  }
}
