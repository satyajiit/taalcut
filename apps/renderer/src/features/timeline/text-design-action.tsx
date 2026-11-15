// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · Operate · component: text design action (TXT1) · system: DESIGN.md v0.6 + UX4
 * in the inspector of a selected on-screen text: one action that asks Taalcut, through the docked chat, to design
 *   the look of this video's text and put its texts in place again. The look is the whole video's (every text of
 *   a role wears it), so the action says so. Nothing here picks a look, and nothing is restyled until the person
 *   asks: a video made before TXT1 keeps the look it has until then.
 * states: default (a line says what happens) · hover, focus and active are the kit's · sending (the button spins
 *   until the chat takes the request) · disabled while Taalcut works in the chat or another request waits (the
 *   line says it is working)
 * motion: none of its own · pre-emit critique: P4 H4 E4 S4 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { AiMarkIcon, Button } from '@taalcut/ui';
import { useState } from 'react';
import { sendInChat, useDockedChat } from './dock/chat-requests';

/** Asks Taalcut to design this video's text and place it again. */
export function TextDesignAction() {
  const { t } = useLingui();
  const chat = useDockedChat();
  /** The tick of the request this control made, to know when the chat has taken it. */
  const [asked, setAsked] = useState(0);
  const sending = asked > 0 && chat.waiting === asked;
  // One request waits at a time (a second would replace it), and a chat that is working takes nothing new.
  const held = chat.busy || (chat.waiting > 0 && !sending);
  const design = () => {
    if (held || sending) return;
    setAsked(
      sendInChat({
        text: t`Design the text of this video: give every text a designed look based on the reference's look, and put each text where it should sit.`,
        selections: [],
      }),
    );
  };
  return (
    <div data-slot="text-design-action" className="flex flex-col gap-1.5">
      <div>
        <Button
          size="sm"
          variant="secondary"
          icon={AiMarkIcon}
          disabled={held}
          loading={sending}
          onClick={design}
        >
          {t`Design text with AI`}
        </Button>
      </div>
      <p role="status" className="m-0 type-meta text-ink-2">
        {sending
          ? t`Sending to the chat…`
          : chat.busy
            ? t`Taalcut is working in the chat. You can ask when it is done.`
            : t`Taalcut designs the look of all the text in this video and puts each text in place. Texts you moved stay where you put them.`}
      </p>
    </div>
  );
}
