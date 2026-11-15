// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: "Design text with AI" in a selected text's inspector. It asks the docked chat to design the look of the
 * video's text and place its texts: words only, no selection (the look is the whole video's). Busy until the chat
 * takes the request, unavailable while the chat works. Nothing is restyled unless the person presses it.
 */
import { chatContract, newId } from '@taalcut/core';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageExtras } from '../src/chat/use-conversation';
import { chatSendRequests, useChatSendDock, useChatSends } from '../src/features/timeline/dock/chat-requests';
import { TextDesignAction } from '../src/features/timeline/text-design-action';
import { mountEditorControl } from './simple-editor-support';

const WORDS =
  "Design the text of this video: give every text a designed look based on the reference's look, and put each " +
  'text where it should sit.';
const IDLE =
  'Taalcut designs the look of all the text in this video and puts each text in place. Texts you moved stay ' +
  'where you put them.';

/** What the docked chat does with the request that waits: takes it. */
const take = () => {
  const latest = chatSendRequests.latest();
  if (latest) chatSendRequests.claim(latest.tick);
};
afterEach(() => act(take));

const button = () => screen.getByRole('button', { name: 'Design text with AI' }) as HTMLButtonElement;

type Send = (text: string, reasoning?: undefined, extras?: MessageExtras) => void;
function Chat({ send, ready = true, busy = false }: { send: Send; ready?: boolean; busy?: boolean }) {
  useChatSends(send, ready, busy);
  return null;
}

describe('Design text with AI (TXT1)', () => {
  it('sends its words to the docked chat, with no selection, as a message the chat contract takes', () => {
    mountEditorControl(<TextDesignAction />);
    expect(screen.getByRole('status').textContent).toBe(IDLE);
    const before = chatSendRequests.latest()?.tick ?? 0;
    fireEvent.click(button());
    expect(chatSendRequests.latest()?.tick).toBe(before + 1);
    expect(chatSendRequests.latest()!.value).toEqual({ text: WORDS, selections: [] });
    const message = { conversationId: newId<'Conversation'>(), text: WORDS };
    expect(chatContract.send['~orpc'].inputSchema?.safeParse(message).success).toBe(true);
  });

  it('is busy until the chat takes the request, and asks once however often it is pressed', () => {
    const send = vi.fn<Send>();
    const open = vi.fn();
    function Page({ ready }: { ready: boolean }) {
      useChatSendDock(open);
      return (
        <>
          <TextDesignAction />
          <Chat send={send} ready={ready} />
        </>
      );
    }
    const view = mountEditorControl(<Page ready={false} />);
    fireEvent.click(button());
    expect(open).toHaveBeenCalledWith('chat');
    expect(button().getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Sending to the chat…');
    const waiting = chatSendRequests.latest()!.tick;
    fireEvent.click(button());
    expect(chatSendRequests.latest()!.tick).toBe(waiting);
    view.rerender(<Page ready />);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(WORDS, undefined, { selections: [] });
    expect(button().disabled).toBe(false);
    expect(screen.getByRole('status').textContent).toBe(IDLE);
  });

  it('is unavailable while the chat works', () => {
    const send = vi.fn<Send>();
    mountEditorControl(
      <>
        <TextDesignAction />
        <Chat send={send} busy />
      </>,
    );
    expect(button().disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe(
      'Taalcut is working in the chat. You can ask when it is done.',
    );
    fireEvent.click(button());
    expect(send).not.toHaveBeenCalled();
  });
});
