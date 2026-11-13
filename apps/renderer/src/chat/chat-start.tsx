// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: chat start · genre: atmospheric studio app (brand moment, v0.4 UX1)
 * system: DESIGN.md v0.4 (A10: the empty state shows what the area holds: a conversation starts here)
 * mascot: Kaatu (88 px, decorative) beside the heading, its drawing on the column's left edge, the edge the tiles,
 *   the recipe chips and the composer share; it goes once the chat has messages (the working line keeps a small one
 *   while the agent runs)
 * type: the heading is a section heading, 600 on the 2xl step (DESIGN.md "Weights"; 700 is for display, the
 *   toolbar title and decision cards)
 * motion: the screen's one entrance starts here, the heading then its line (StaggerGroup, 45 ms apart), and runs on
 *   through the four choice tiles and the chips (new-chat-choices.tsx, the kit's opening-entrance.tsx): the stated
 *   exception to "what was there when a page opened shows at once" (DESIGN.md v0.4, Empty states)
 * the opening choices (P2-M13) sit under it, above the composer: new-chat-choices.tsx
 * tip (UX4): the page's first-visit tip, under the line, until dismissed (features/kaatu/page-tip.tsx). Words
 *   alone: Kaatu is already beside the heading, and a screen has one Kaatu besides the companion. It shows at once,
 *   outside the entrance. */

import { Trans } from '@lingui/react/macro';
import { Kaatu, StaggerGroup, StaggerItem, useIdleMood } from '@taalcut/ui';
import { PageTip } from '../features/kaatu/page-tip';

/**
 * The heading and a line on what happens, above the composer of a chat with
 * nothing in it yet, with Kaatu beside them: watching the pointer, asleep
 * after a quiet minute.
 */
export function ChatStartIntro() {
  const mood = useIdleMood();
  return (
    <div data-slot="chat-start" className="flex items-center gap-5">
      <Kaatu spot="hero" mood={mood} />
      <StaggerGroup className="flex min-w-0 flex-col gap-2">
        <StaggerItem>
          <h2 className="m-0 text-2xl font-semibold tracking-tight text-balance text-ink">
            <Trans>Tell Taalcut what to make</Trans>
          </h2>
        </StaggerItem>
        <StaggerItem>
          <p className="m-0 max-w-[60ch] text-md text-pretty text-ink-2">
            <Trans>
              Pick a way in, or describe the video below. Taalcut shows its plan before it changes anything.
            </Trans>
          </p>
        </StaggerItem>
        <PageTip id="chat-start" kaatu={false} className="mt-1">
          <Trans>
            Your chats stay in the sidebar under Recent chats: pick one to carry on where you left it.
          </Trans>
        </PageTip>
      </StaggerGroup>
    </div>
  );
}
