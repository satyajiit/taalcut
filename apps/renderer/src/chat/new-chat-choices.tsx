// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: chat start, the opening choices (wiring) · genre: atmospheric studio app (brand moment)
 * system: DESIGN.md v0.4 · the kit's OpeningChoices on a new chat, before any run, as choice tiles that join the
 *   intro's entrance: what this Mac allows (Local only turns the reel link off and keeps the file) and whether there
 *   are sources. Under them, set apart from the tiles and close to the composer they fill, up to three recipe chips
 *   (P3-V11) that put a starter prompt in the composer; they enter last · states: the kit's */

import { OPENING_PATHS } from '@taalcut/core';
import {
  CardActionsProvider,
  CardDataProvider,
  OpeningChoices,
  OpeningEntrance,
  type CardActions,
} from '@taalcut/ui';
import { useMemo } from 'react';
import { useBackend } from '../backend/backend';
import { useRpcQuery } from '../backend/use-rpc';
import { EmptyRecipes } from '../features/recipes/empty-recipes';
import { EMPTY_CONTEXT } from '../features/recipes/recipe-filter';
import { useAppCardData } from './card-data';
import { MakeShortButton } from '../features/shorts/make-short-button';

/**
 * The four ways in on an empty chat (P2-M13): the openingChoices card
 * rendered by the window itself, no run yet. `actions` start the flow (in this
 * chat, or in a new one from the new-chat page) and focus the composer. Under
 * them, recipes that need nothing open (P3-V11).
 */
export function NewChatChoices({
  actions,
  busy = false,
  onCreateShort,
}: {
  actions: CardActions;
  busy?: boolean;
  onCreateShort?: (text: string) => void;
}) {
  const backend = useBackend();
  const data = useAppCardData();
  const privacy = useRpcQuery((signal) => backend.privacy.overview(undefined, { signal }), [backend]);
  const sources = useRpcQuery((signal) => backend.library.sources(undefined, { signal }), [backend]);
  const localOnly = privacy.data?.localOnly === true;
  const unavailable = useMemo(
    () => (localOnly ? [{ path: 'reference' as const, reasonKey: 'opening.reference.localOnly' }] : []),
    [localOnly],
  );
  // Until the list arrives, assume there are sources: the choice then starts the flow, whose source step asks.
  const hasSources = sources.data ? sources.data.length > 0 : true;
  return (
    // The chips are the composer's first messages: further from the tiles than from the composer below.
    <div data-slot="new-chat-choices" className="flex flex-col gap-7">
      <CardActionsProvider value={actions}>
        <CardDataProvider value={data}>
          <OpeningChoices
            paths={OPENING_PATHS}
            unavailable={unavailable}
            hasSources={hasSources}
            busy={busy}
            enter
          />
        </CardDataProvider>
      </CardActionsProvider>
      <div className="self-start">
        <MakeShortButton disabled={busy} localOnly={localOnly} onCreate={onCreateShort} />
      </div>
      <OpeningEntrance index={OPENING_PATHS.length} enter className="empty:hidden">
        <EmptyRecipes context={EMPTY_CONTEXT} />
      </OpeningEntrance>
    </div>
  );
}
