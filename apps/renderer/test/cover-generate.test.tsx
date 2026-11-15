// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CVR1: the cover panel's "Generate with AI". It asks the docked chat for a cover at the aspect picked in the cover
 * editor: the words as a message, the aspect and the note with them as data (core's `CoverRequest`). The button is
 * busy until the chat takes the request and unavailable while the chat works.
 */
import { chatContract, coverRequestSchema, newId, THUMBNAIL_ASPECTS } from '@taalcut/core';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageExtras } from '../src/chat/use-conversation';
import { CoverGenerate } from '../src/features/timeline/cover-generate';
import { CoverPanel } from '../src/features/timeline/cover-panel';
import {
  chatSendRequests,
  sendInChat,
  useChatSendDock,
  useChatSends,
} from '../src/features/timeline/dock/chat-requests';
import { editorFixture, mountEditorControl } from './simple-editor-support';

// The panel's cards read the app's backend; here the cover editor works without one (no preview, no export).
vi.mock('../src/chat/card-actions', () => ({ useAppCardActions: () => ({}) }));
vi.mock('../src/chat/card-data', () => ({ useAppCardData: () => ({}) }));

/** What the docked chat does with the request that waits: takes it. */
const take = () => {
  const latest = chatSendRequests.latest();
  if (latest) chatSendRequests.claim(latest.tick);
};
afterEach(() => act(take));

const sent = () => chatSendRequests.latest()!.value;
const button = () => screen.getByRole('button', { name: 'Generate with AI' });
const note = () => screen.getByLabelText('What should the cover show or say? (optional)');

type Send = (text: string, reasoning?: undefined, extras?: MessageExtras) => void;
/** The docked chat's side of the requests, as project-chat.tsx mounts it. */
function Chat({ send, ready = true, busy = false }: { send: Send; ready?: boolean; busy?: boolean }) {
  useChatSends(send, ready, busy);
  return null;
}

describe('Generate with AI in the cover panel (CVR1)', () => {
  it('asks for a cover at the aspect picked in the cover editor, with the note, as words and as data', () => {
    const { timeline, playhead } = editorFixture();
    mountEditorControl(<CoverPanel timeline={timeline} playhead={playhead} paused={false} />);
    const editor = screen.getByRole('region', { name: 'Choose cover' });
    expect(within(editor).getByRole('button', { name: 'Generate with AI' })).toBeTruthy();
    expect(screen.getByText('Taalcut designs a 9:16 cover in the chat and saves it here.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '16:9 YouTube' }));
    expect(screen.getByText('Taalcut designs a 16:9 cover in the chat and saves it here.')).toBeTruthy();
    fireEvent.change(note(), { target: { value: '  The harbour at dusk, big title  ' } });
    const before = chatSendRequests.latest()?.tick ?? 0;
    fireEvent.click(button());

    expect(chatSendRequests.latest()?.tick).toBe(before + 1);
    expect(sent()).toEqual({
      text: 'Generate a 16:9 cover for this video. The harbour at dusk, big title',
      selections: [],
      cover: { aspect: '16:9', note: 'The harbour at dusk, big title' },
    });
    // The request is one the chat contract takes as it is.
    expect(coverRequestSchema.safeParse(sent().cover).success).toBe(true);
    const message = { conversationId: newId<'Conversation'>(), text: sent().text, cover: sent().cover };
    expect(chatContract.send['~orpc'].inputSchema?.safeParse(message).success).toBe(true);
  });

  it('says exactly "Generate a <aspect> cover for this video." for each aspect, and no note when none is written', () => {
    for (const aspect of THUMBNAIL_ASPECTS) {
      const view = mountEditorControl(<CoverGenerate aspect={aspect} paused={false} />);
      fireEvent.change(note(), { target: { value: '   ' } });
      fireEvent.click(button());
      // packages/agent/test/editor/cover-request.test.ts holds these same words to the Editor's route: they carry
      // none of the phrases that ask for a new video (the agent's MAKE_WORDS, which the renderer cannot import).
      expect(sent()).toEqual({
        text: `Generate a ${aspect} cover for this video.`,
        selections: [],
        cover: { aspect },
      });
      act(take);
      view.unmount();
    }
  });

  it('is busy until the chat takes the request, then free again; Enter in the note asks too', () => {
    const send = vi.fn<Send>();
    const open = vi.fn();
    function Page({ ready }: { ready: boolean }) {
      useChatSendDock(open);
      return (
        <>
          <CoverGenerate aspect="4:5" paused={false} />
          <Chat send={send} ready={ready} />
        </>
      );
    }
    const view = mountEditorControl(<Page ready={false} />);
    fireEvent.change(note(), { target: { value: 'Night market' } });
    fireEvent.submit(note().closest('form')!);
    // The page opens the dock on the chat; the chat is still opening, so the request waits and the button says so.
    expect(open).toHaveBeenCalledWith('chat');
    expect(button().getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Sending to the chat…');
    const waiting = chatSendRequests.latest()!.tick;
    fireEvent.click(button());
    fireEvent.submit(note().closest('form')!);
    expect(chatSendRequests.latest()!.tick).toBe(waiting);
    expect(send).not.toHaveBeenCalled();

    view.rerender(<Page ready />);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('Generate a 4:5 cover for this video. Night market', undefined, {
      selections: [],
      cover: { aspect: '4:5', note: 'Night market' },
    });
    expect(button().getAttribute('aria-busy')).toBeNull();
    expect((button() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('status').textContent).toBe(
      'Taalcut designs a 4:5 cover in the chat and saves it here.',
    );
  });

  it('is unavailable while the chat works, while another request waits and while the editor is paused', () => {
    const send = vi.fn<Send>();
    const disabled = () => (button() as HTMLButtonElement).disabled;
    const Page = ({ busy = false, paused = false }: { busy?: boolean; paused?: boolean }) => (
      <>
        <CoverGenerate aspect="1:1" paused={paused} />
        <Chat send={send} ready={!busy} busy={busy} />
      </>
    );
    const view = mountEditorControl(<Page busy />);
    expect(disabled()).toBe(true);
    expect(screen.getByRole('status').textContent).toBe(
      'Taalcut is working in the chat. You can ask when it is done.',
    );
    const before = chatSendRequests.latest()?.tick ?? 0;
    fireEvent.click(button());
    fireEvent.submit(note().closest('form')!);
    expect(chatSendRequests.latest()?.tick ?? 0).toBe(before);

    // Another control's request (a graphic's Try again) waits for the busy chat: a second would replace it.
    act(() => void sendInChat({ text: 'Try again: design this graphic another way.', selections: [] }));
    expect(disabled()).toBe(true);
    expect(button().getAttribute('aria-busy')).toBeNull();
    view.rerender(<Page />);
    // The chat is free: it takes the waiting request as it was (no cover on it), and the control is free again.
    expect(send).toHaveBeenCalledWith('Try again: design this graphic another way.', undefined, {
      selections: [],
    });
    expect(disabled()).toBe(false);

    view.rerender(<Page paused />);
    expect(disabled()).toBe(true);
    fireEvent.submit(note().closest('form')!);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
