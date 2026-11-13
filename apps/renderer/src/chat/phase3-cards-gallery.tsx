// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: UI kit, the make flow's Phase 3 cards · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: DESIGN.md v0.3 · every state of the variants compare, gap fix, hub results, cleanup
 *   plan, style batch, voiceover, voice consent, motion graphic, batch render and image takes cards, on the app's
 *   live actions and data, so they are screenshotted and checked with axe like the other cards
 * states: each card's own (its fixture names the state under it) · pre-emit critique: P4 H4 E4 S4 R5 V4
 */
import { ok, type Card } from '@taalcut/core';
import { CardActionsProvider, CardDataProvider, CardView, CARD_FIXTURES } from '@taalcut/ui';
import { useMemo } from 'react';
import { AppVariantPlayers } from '../features/timeline/variants/app-variant-players';
import { useAppCardActions } from './card-actions';
import { useAppCardData } from './card-data';

/** The make flow's Phase 3 card types, in the order a run meets them. */
export const PHASE3_KIT_TYPES = [
  'variantsCompare',
  'gapFix',
  'imageTakes',
  'cleanupPlan',
  'voiceover',
  'voiceConsent',
  'motionGraphic',
  'styleBatch',
  'renderBatch',
  'hubResults',
] as const;

function kitCards(): { readonly name: string; readonly card: Card }[] {
  const cards = PHASE3_KIT_TYPES.flatMap((type) =>
    Object.entries(CARD_FIXTURES[type]).map(([state, card]) => ({
      name: `${type} · ${state}`,
      card: card satisfies Card,
    })),
  );
  return [...cards, { name: 'toolRun · saved cover', card: CARD_FIXTURES.toolRun['saved cover']! }];
}

export function Phase3CardsGallery() {
  const actions = useAppCardActions();
  const data = useAppCardData();
  const cards = useMemo(kitCards, []);
  // A decision that can't reach a run does nothing here.
  // The kit shows every button: an answer, a question for the composer or a paid follow-up go nowhere here.
  const kitActions = useMemo(
    () => ({
      ...actions,
      // No run takes the answer here: the card hears it went, as it would in a chat.
      decide: async () => ok('answered' as const),
      ask: () => undefined,
      followUp: async () => ok(undefined),
    }),
    [actions],
  );
  return (
    <CardActionsProvider value={kitActions}>
      <CardDataProvider value={data}>
        <AppVariantPlayers>
          <div className="flex flex-col gap-10" data-slot="phase3-cards-gallery">
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
        </AppVariantPlayers>
      </CardDataProvider>
    </CardActionsProvider>
  );
}
