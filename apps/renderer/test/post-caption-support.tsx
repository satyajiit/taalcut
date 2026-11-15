// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CAP1: the caption dialog over the fake backend and the fake chat, as the editor mounts them. The page follows
 * the fake's timeline (so a caption saved anywhere lands in the dialog), and a stand-in for the docked chat takes
 * the dialog's request and sends it to the fake chat service with the editor's context, as project-chat.tsx does.
 */
import { I18nProvider } from '@lingui/react';
import { newId, RationalTime, type ChatService } from '@taalcut/core';
import { render, screen } from '@testing-library/react';
import { useEffect, useState, type ReactNode } from 'react';
import { vi } from 'vitest';
import { BackendProvider } from '../src/backend/backend';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { GOLDEN_TIMELINES } from '../src/backend/fake/make/ids';
import { createFakeChatClient } from '../src/chat/fake-client';
import type { MessageExtras } from '../src/chat/use-conversation';
import { useChatSends } from '../src/features/timeline/dock/chat-requests';
import { PostCaptionDialog } from '../src/features/timeline/post-caption/post-caption-dialog';
import { activateLocale, i18n } from '../src/i18n/i18n';

export const TIMELINE = GOLDEN_TIMELINES[0]!;
export type FakeBackend = ReturnType<typeof createFakeBackend>;
export type Send = (text: string, reasoning?: undefined, extras?: MessageExtras) => void;

export function captionFake(): FakeBackend {
  const fake = createFakeBackend({ phase2: { library: { tickMs: 0 }, templateMedia: { tickMs: 0 } } });
  window.taalcutFake = fake.controls;
  return fake;
}

/** The docked chat's side, with what it does left to the test: when it is ready, and whether a run is going. */
export function ChatStub({
  send,
  ready = true,
  busy = false,
}: {
  send: Send;
  ready?: boolean;
  busy?: boolean;
}) {
  useChatSends(send, ready, busy);
  return null;
}

/** The docked chat over the fake chat service: it sends the request with the editor's context and runs it out. */
export function FakeChat({ fake, chat }: { fake: FakeBackend; chat: ChatService }) {
  const [busy, setBusy] = useState(false);
  const send: Send = (text, _reasoning, extras) => {
    const timeline = fake.controls.make.timelines.get(TIMELINE)!;
    setBusy(true);
    void (async () => {
      const sent = await chat.send(
        {
          conversationId: newId<'Conversation'>(),
          text,
          editorContext: {
            timelineId: timeline.id,
            revision: timeline.revision,
            playhead: RationalTime.of(0, timeline.canvas.rate),
            selection: [],
          },
          ...(extras?.postCaption ? { postCaption: extras.postCaption } : {}),
        },
        { signal: new AbortController().signal },
      );
      if (sent.ok) for await (const event of sent.value.events) void event;
      setBusy(false);
    })();
  };
  useChatSends(send, true, busy);
  return null;
}

/** The dialog, open, over the fake's timeline as it changes; `children` is the docked chat's side. */
export function CaptionPage({ fake, children }: { fake: FakeBackend; children?: ReactNode }) {
  const timelines = fake.controls.make.timelines;
  const [timeline, setTimeline] = useState(() => timelines.get(TIMELINE)!);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const stop = new AbortController();
    void (async () => {
      for await (const next of timelines.watch(TIMELINE, stop.signal)) setTimeline(next);
    })();
    return () => stop.abort();
  }, [timelines]);
  return (
    <I18nProvider i18n={i18n}>
      <BackendProvider backend={fake.client}>
        <button type="button" onClick={() => setOpen(true)}>
          open the caption
        </button>
        <PostCaptionDialog timeline={timeline} open={open} onOpenChange={setOpen} />
        {children}
      </BackendProvider>
    </I18nProvider>
  );
}

/** Mounts the dialog, open, over `fake` (a new one by default) with the fake chat behind it. */
export async function mountCaption(fake: FakeBackend = captionFake()) {
  await activateLocale('en', 'mac');
  const chat = createFakeChatClient({ latencyMs: 0, speed: 0 });
  const sent = vi.spyOn(chat, 'send');
  const view = render(
    <CaptionPage fake={fake}>
      <FakeChat fake={fake} chat={chat} />
    </CaptionPage>,
  );
  return { fake, chat, sent, view, saved: () => fake.controls.make.timelines.get(TIMELINE)!.postCaptions };
}

export const box = () => screen.getByLabelText('Caption text') as HTMLTextAreaElement;
export const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
export const status = () => document.querySelector('[data-slot="post-caption-status"]')!.textContent;
export const author = () =>
  document.querySelector('[data-slot="post-caption-plate"] [data-slot="chip"]')!.textContent;
export const flags = () =>
  [...document.querySelectorAll('[data-slot="post-caption-flags"] li')].map((flag) => flag.textContent);
