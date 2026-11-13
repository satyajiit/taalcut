// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { Stories } from '#components/your-ai/stories/stories';
import { Arrive, Section } from '#components/ui/section';
import { PROVIDER_GRID } from '#content/providers';

/* section: /ai/ › The AI it works with · mode: Persuade · system: WEB2 Remix Vernacular
 * states: the stories' own (stories/stories: every story in one row in the server HTML; the tray and the viewer once
 *   the page runs, one story playing on arrival); the section arrives once. motion: the arrival, then the story's run.
 * Every AI Taalcut works with as a stories tray (a round avatar each, its ring the way in, the ways labelled across
 * the top), and the open AI's story in a 9:16 frame between its neighbours: what it does, then how it comes in, one fact
 * a segment (your key in Settings › Accounts, kept encrypted with a key in your computer's keychain, the US$2 budget;
 * your own server, which you never need; what always runs on your computer). OpenAI's story is open at first; the
 * ChatGPT one links up to its demo. */

export function ProvidersSection() {
  return (
    <Section id="providers" heading={PROVIDER_GRID.heading} lead={PROVIDER_GRID.lead}>
      <Arrive>
        <Stories variant="full" initial="openai" chatgptLink="#chatgpt" />
      </Arrive>
    </Section>
  );
}
