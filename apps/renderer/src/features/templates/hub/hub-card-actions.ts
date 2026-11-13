// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CardActions } from '@taalcut/ui';
import type { useNavigate } from '@tanstack/react-router';
import type { Backend } from '../../../backend/backend';
import { openHubShare } from './share-requests';
import { forkFromHub } from './use-fork';

/** P3-B12: a card's Fork (hub.fork under a new template id) and Share (the template's page, its dialog open). */
export function hubCardActions(
  backend: Backend,
  navigate: ReturnType<typeof useNavigate>,
): Pick<CardActions, 'hub'> {
  return {
    hub: {
      fork: (request) => forkFromHub(backend, request),
      openShare: (templateId, version) => openHubShare(navigate, templateId, version),
    },
  };
}
