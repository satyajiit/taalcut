// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { ChatgptDemo } from '#components/your-ai/stories/chatgpt-demo';
import { Arrive, Section } from '#components/ui/section';
import { CHATGPT } from '#content/providers';

/* section: /ai/ › Continue with ChatGPT · mode: Persuade · system: WEB2 Remix Vernacular
 * states: the demo's own (stories/chatgpt-demo: finished in the server HTML and under reduced motion, one run on
 *   arrival, Play again); the section arrives once. motion: the section's arrival, then the demo's run.
 * The page's lead, and its boldest: the coded window plays the sign-in under its segment bar (Settings › Accounts,
 * OpenAI's page, Using ChatGPT plan), larger than any window after it, with each step's facts beside it in big words and
 * two stickers on the window. No list beside it: the facts ride the steps. */

export function ChatgptSection() {
  return (
    <Section id="chatgpt" heading={CHATGPT.heading} lead={CHATGPT.lead} tone="sunken">
      <Arrive>
        <ChatgptDemo />
      </Arrive>
    </Section>
  );
}
