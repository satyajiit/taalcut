// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { callRpc } from '@taalcut/core';
import type { CardData } from '@taalcut/ui';
import type { Backend } from '../../../backend/backend';

/**
 * P3-B12: a hub entry as the hub says now (hub.get), for the hub results card: undefined once it is gone (hidden or
 * no longer listed). Any other failure (offline, Local only) rejects, and the card keeps its snapshot.
 */
export function hubCardData(backend: Backend): Pick<CardData, 'hubItem'> {
  return {
    async hubItem(hubId) {
      const got = await callRpc(backend.hub.get({ hubId }));
      if (got.ok) return got.value.item;
      if (got.error.code === 'hub.hidden' || got.error.code === 'hub.not_found') return undefined;
      throw new Error(got.error.code);
    },
  };
}
