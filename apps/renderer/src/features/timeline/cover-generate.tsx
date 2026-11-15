// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: cover generate (CVR1) · genre: atmospheric studio app (the timeline)
 * system: DESIGN.md v0.3 · in the cover panel, under the aspect choice: one line for what the cover should show
 *   or say (optional), and "Generate with AI" with the kit's AI mark. It asks the docked chat for a cover at the
 *   aspect picked above: the words go as a message, the aspect and the note with them as data, and the chat
 *   opens. Taalcut designs the cover; nothing here picks a look.
 * states: default (a line says what happens, with the aspect) · hover, focus and active are the kit's · sending
 *   (the button spins until the chat takes the request) · disabled while Taalcut works in the chat, another
 *   request waits or the AI holds the timeline (the line says it is working)
 * motion: none of its own · pre-emit critique: P4 H4 E4 S4 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { COVER_NOTE_MAX, type CoverRequest } from '@taalcut/core';
import { AiMarkIcon, Button, Input } from '@taalcut/ui';
import { useState } from 'react';
import { sendInChat, useDockedChat } from './dock/chat-requests';

export interface CoverGenerateProps {
  /** The aspect picked in the cover editor: the cover is asked for at it. */
  readonly aspect: CoverRequest['aspect'];
  /** The editor's own pause: the AI holds the timeline, or an edit is on its way. */
  readonly paused: boolean;
}

/** Asks Taalcut, through the docked chat, to design this video's cover at the aspect picked in the cover editor. */
export function CoverGenerate({ aspect, paused }: CoverGenerateProps) {
  const { t } = useLingui();
  const chat = useDockedChat();
  const [note, setNote] = useState('');
  /** The tick of the request this control made, to know when the chat has taken it. */
  const [asked, setAsked] = useState(0);
  const sending = asked > 0 && chat.waiting === asked;
  // One request waits at a time (a second would replace it), and a chat that is working takes nothing new.
  const held = paused || chat.busy || (chat.waiting > 0 && !sending);
  const generate = () => {
    if (held || sending) return;
    const words = note.trim();
    const request = t`Generate a ${aspect} cover for this video.`;
    setAsked(
      sendInChat({
        text: words ? `${request} ${words}` : request,
        selections: [],
        cover: { aspect, ...(words ? { note: words } : {}) },
      }),
    );
  };
  return (
    <form
      data-slot="cover-generate"
      className="flex flex-col gap-2 rounded-lg border border-rule-subtle p-3"
      onSubmit={(event) => {
        event.preventDefault();
        generate();
      }}
    >
      <label className="flex flex-col gap-1 type-label">
        {t`What should the cover show or say? (optional)`}
        <Input value={note} maxLength={COVER_NOTE_MAX} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button type="submit" size="sm" icon={AiMarkIcon} disabled={held} loading={sending}>
          {t`Generate with AI`}
        </Button>
        <p role="status" className="m-0 min-w-0 flex-1 basis-40 type-meta text-ink-2">
          {sending
            ? t`Sending to the chat…`
            : chat.busy
              ? t`Taalcut is working in the chat. You can ask when it is done.`
              : t`Taalcut designs a ${aspect} cover in the chat and saves it here.`}
        </p>
      </div>
    </form>
  );
}
