// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: UI kit, memory.remember's card (LRN1-MEM) · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: DESIGN.md v0.3 · every state of "Remember this?" on the app's live actions, so it is
 *   screenshotted and checked with axe like the other cards
 * states: each card's own (its fixture names the state under it)
 */
import { ok, type Card } from '@taalcut/core';
import { CardActionsProvider, CardView, CARD_FIXTURES } from '@taalcut/ui';
import { useMemo } from 'react';
import { useAppCardActions } from '../../../chat/card-actions';

const cards: readonly { readonly name: string; readonly card: Card }[] = Object.entries(
  CARD_FIXTURES.memoryProposal,
).map(([state, card]) => ({ name: `memoryProposal · ${state}`, card }));

export function MemoryCardsGallery() {
  const actions = useAppCardActions();
  // No run takes the answer here: the card hears it went, as it would in a chat.
  const kitActions = useMemo(() => ({ ...actions, decide: async () => ok('answered' as const) }), [actions]);
  return (
    <CardActionsProvider value={kitActions}>
      <div className="flex flex-col gap-10" data-slot="memory-cards-gallery">
        {cards.map(({ name, card }) => (
          <figure key={name} data-fixture={name} className="m-0 flex flex-col gap-2">
            <CardView card={{ ...card, id: `kit-${name}` }} />
            {/* The fixture's name: an identifier, as the kit's other captions. */}
            <figcaption className="tc-mono type-meta text-ink-3" translate="no">
              {name}
            </figcaption>
          </figure>
        ))}
      </div>
    </CardActionsProvider>
  );
}
