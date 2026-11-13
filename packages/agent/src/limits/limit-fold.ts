// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The fold for G8's log types (limit-events.ts): part of state.ts's pure fold. */
import type { EventOf } from '../events';
import type { RunState } from '../run-state';

type LimitEvent = EventOf<'limit.waiting'> | EventOf<'limit.resumed'> | EventOf<'limit.switched'>;

export function applyLimitEvent(state: RunState, event: LimitEvent): void {
  switch (event.type) {
    case 'limit.waiting':
      state.limitWait = { requestId: event.payload.requestId, until: event.payload.until };
      break;
    case 'limit.resumed':
      if (state.limitWait?.requestId === event.payload.requestId) state.limitWait = undefined;
      break;
    case 'limit.switched':
      state.modelOverrides = { ...state.modelOverrides, [event.payload.module]: { ...event.payload.to } };
      break;
  }
}
