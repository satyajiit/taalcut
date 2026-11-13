// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: UI kit, rate limits and external agents · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: DESIGN.md v0.3 · every state of G8's rateLimit card, an external agent's approval
 *   (P3-V4; and its consent and budget-cap asks, P3-3) and the source picker with the phone's two ways in (P3-B4), on the app's live actions and data, so they
 *   are screenshotted and checked with axe like the other cards. A limit's reset time is moved to a quarter-hour
 *   from now (the fixtures' times are fixed), so the countdown shows as the chat would.
 * states: each card's own (its fixture names the state under it)
 */
import { ok, type Card } from '@taalcut/core';
import { CardActionsProvider, CardDataProvider, CardView, CARD_FIXTURES } from '@taalcut/ui';
import { useMemo } from 'react';
import { useAppCardActions } from './card-actions';
import { useAppCardData } from './card-data';

const RESET_IN_MS = 12 * 60_000 + 30_000;

/**
 * The kit's cards: the limit card in every state, the external agent's asks, the source picker's phone, and the
 * import progress card in every state (IX-R3: searchable, every clip searchable, paused, some failed, done).
 */
function kitCards(now: number): { readonly name: string; readonly card: Card }[] {
  const limits = Object.entries(CARD_FIXTURES.rateLimit).map(([state, card]) => ({
    name: `rateLimit · ${state}`,
    card: { ...card, resetsAt: card.resetsAt === null ? null : now + RESET_IN_MS } satisfies Card,
  }));
  // An external agent's asks (round P3-3): each card that names who is asking.
  const asks = (['approval', 'consent', 'budgetCap'] as const).flatMap((type) =>
    Object.entries(CARD_FIXTURES[type])
      .filter(([, card]) => card.requester !== undefined)
      .map(([state, card]) => ({ name: `${type} · ${state}`, card: card satisfies Card })),
  );
  const pickers = Object.entries(CARD_FIXTURES.sourcePicker).map(([state, card]) => ({
    name: `sourcePicker · ${state}`,
    card: card satisfies Card,
  }));
  const imports = Object.entries(CARD_FIXTURES.importProgress).map(([state, card]) => ({
    name: `importProgress · ${state}`,
    card: card satisfies Card,
  }));
  return [...limits, ...asks, ...pickers, ...imports];
}

export function LimitCardsGallery() {
  const actions = useAppCardActions();
  const data = useAppCardData();
  // A countdown is from when the kit opened; a decision that can't reach a run does nothing here.
  const cards = useMemo(() => kitCards(Date.now()), []);
  const kitActions = useMemo(() => ({ ...actions, decide: async () => ok('answered' as const) }), [actions]);
  return (
    <CardActionsProvider value={kitActions}>
      <CardDataProvider value={data}>
        <div className="flex flex-col gap-10" data-slot="limit-cards-gallery">
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
      </CardDataProvider>
    </CardActionsProvider>
  );
}
