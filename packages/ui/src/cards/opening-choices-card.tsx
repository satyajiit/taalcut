// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: openingChoices card · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.4 · not a decision card: the chat start's choice tiles, 2 × 2 on the canvas, under a small
 *   heading that starts on the tiles' left edge; no entrance of its own (it arrives with the agent's turn)
 * states: OpeningChoices' (default · hover · focus · active · disabled while a run goes · loading · error · open ·
 *   success) */

import { useLingui } from '@lingui/react/macro';
import type { CardOf } from '@taalcut/core';
import { useCardActions } from './card-actions';
import { OpeningChoices } from './opening-choices';

/**
 * The opening choices as the agent sends them: after a flow ends, to make
 * another (agent SPEC section 13). A new chat shows the same choices before any
 * run, built by the window itself.
 */
export function OpeningChoicesCard({ card }: { card: CardOf<'openingChoices'> }) {
  const { t } = useLingui();
  const { busy } = useCardActions();
  const title = card.runId ? t`Make another video?` : t`How do you want to start?`;
  return (
    <div data-slot="smart-card" data-card-type="openingChoices" className="flex max-w-[42rem] flex-col">
      <OpeningChoices
        title={<h3 className="m-0 text-md font-semibold text-ink">{title}</h3>}
        paths={card.paths}
        unavailable={card.unavailable}
        hasSources={card.hasSources}
        chosen={card.chosen}
        busy={busy ?? false}
      />
    </div>
  );
}
