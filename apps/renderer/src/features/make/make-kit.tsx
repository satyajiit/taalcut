// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: UI kit, the Make cards · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · every state of the five Make cards (cast board, timeline, QA report, render progress,
 *   export approval) from the kit's fixtures, on the app's live data and actions, so a card that reads the
 *   fakes (the Golden hour market timelines, its renders) shows them as the chat would; the render cards keep
 *   their fixture's state (one fake render can't be in all of them at once)
 * states: each card's own (its fixture names the state under it)
 */
import { CardActionsProvider, CardDataProvider, CardView, MAKE_FIXTURES } from '@taalcut/ui';
import type { Card } from '@taalcut/core';
import { useMemo } from 'react';
import { useAppCardActions } from '../../chat/card-actions';
import { useAppCardData } from '../../chat/card-data';

export function MakeCardsGallery() {
  const actions = useAppCardActions();
  const data = useAppCardData();
  const snapshots = useMemo(() => ({ ...data, watchRender: undefined }), [data]);
  return (
    <CardActionsProvider value={actions}>
      <CardDataProvider value={data}>
        <div className="flex flex-col gap-10" data-slot="make-cards-gallery">
          {Object.entries(MAKE_FIXTURES).flatMap(([type, states]) =>
            Object.entries(states as Readonly<Record<string, Card>>).map(([state, card]) => (
              <figure
                key={`${type}/${state}`}
                data-fixture={`${type}/${state}`}
                className="m-0 flex flex-col gap-2"
              >
                {type === 'renderProgress' ? (
                  <CardDataProvider value={snapshots}>
                    <CardView card={{ ...card, id: `kit-${type}-${state}` }} />
                  </CardDataProvider>
                ) : (
                  <CardView card={{ ...card, id: `kit-${type}-${state}` }} />
                )}
                {/* The fixture's name: an identifier, as the kit's other captions. */}
                <figcaption className="font-mono text-xs text-ink-3" translate="no">
                  {`${type} · ${state}`}
                </figcaption>
              </figure>
            )),
          )}
        </div>
      </CardDataProvider>
    </CardActionsProvider>
  );
}
