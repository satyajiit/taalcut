// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { callRpc } from '@taalcut/core';
import type { CardData } from '@taalcut/ui';
import type { Backend } from '../../../backend/backend';

/** P3-V9: a cleanup plan for other switches (timelines.planCleanup), for the cleanup card. A read. */
export function cleanupCardData(backend: Backend): Pick<CardData, 'planCleanup'> {
  return {
    planCleanup: ({ timelineId, settings }) =>
      callRpc(backend.timelines.planCleanup({ timelineId, settings })),
  };
}
