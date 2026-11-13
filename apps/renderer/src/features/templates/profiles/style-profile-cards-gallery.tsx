// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: UI kit, templates.styleProfile's card (LRN1-STY) · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: DESIGN.md v0.4 · each state of "What your saved reels have in common" in the chat, on
 *   the app's live actions and media, so it is screenshotted and checked with axe like the other cards
 * states: each card's own (its fixture names the state under it)
 */
import type { Card } from '@taalcut/core';
import { CardActionsProvider, CardView, CARD_FIXTURES } from '@taalcut/ui';
import { useAppCardActions } from '../../../chat/card-actions';

const cards: readonly { readonly name: string; readonly card: Card }[] = Object.entries(
  CARD_FIXTURES.styleProfile,
).map(([state, card]) => ({ name: `styleProfile · ${state}`, card }));

export function StyleProfileCardsGallery() {
  const actions = useAppCardActions();
  return (
    <CardActionsProvider value={actions}>
      <div className="flex flex-col gap-10" data-slot="style-profile-cards-gallery">
        {cards.map(({ name, card }) => (
          <figure key={name} data-fixture={name} className="m-0 flex flex-col gap-2">
            <CardView card={{ ...card, id: `kit-${name}` }} />
            {/* The fixture's name: an identifier, as the kit's other captions. */}
            <figcaption className="font-mono text-xs text-ink-3" translate="no">
              {name}
            </figcaption>
          </figure>
        ))}
      </div>
    </CardActionsProvider>
  );
}
