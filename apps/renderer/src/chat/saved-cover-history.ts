// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { parseCard, type ChatHistoryEvent, type RunId } from '@taalcut/core';
import type { Transcript, TranscriptItem } from './transcript-items';

function belongsTo(item: TranscriptItem, runId: RunId): boolean {
  return (
    ('runId' in item && item.runId === runId) ||
    (item.kind === 'card' && 'runId' in item.card && item.card.runId === runId)
  );
}

/** Late immutable receipts are additions, never an authoritative replay over a newer live stream. */
export function mergeSavedCovers(state: Transcript, history: readonly ChatHistoryEvent[]): Transcript {
  let items = state.items;
  for (const event of history) {
    if (event.type !== 'agent.card') continue;
    const parsed = parseCard(event.payload.card);
    if (!parsed.ok || parsed.value.type !== 'toolRun' || !parsed.value.savedCover) continue;
    const card = parsed.value;
    if (event.payload.runId !== card.runId) continue;
    if (!state.runs[card.runId] || items.some((item) => item.key === card.id)) continue;
    const position = items.findLastIndex((item) => belongsTo(item, card.runId));
    if (position < 0) continue;
    items = [
      ...items.slice(0, position + 1),
      { kind: 'card', key: card.id, card },
      ...items.slice(position + 1),
    ];
  }
  return items === state.items ? state : { ...state, items };
}
