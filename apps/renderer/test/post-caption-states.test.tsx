// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CAP1: how the caption dialog stands while the chat works (the request waiting, Taalcut writing, a run that
 * saved nothing, the chat busy with other work), the words it sends for each platform, and the fake's side: its
 * command keeps the caption as the real one does, and its made-up captions pass the rule they are built by.
 */
import { setupI18n } from '@lingui/core';
import {
  buildPostCaption,
  POST_CAPTION_COMMAND,
  POST_CAPTION_PLATFORMS,
  POST_CAPTION_RULES,
  POST_CAPTION_SETTING_COMMANDS,
} from '@taalcut/core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakePostCaptionParts } from '../src/chat/fake-post-caption-script';
import { chatSendRequests, sendInChat } from '../src/features/timeline/dock/chat-requests';
import {
  postCaptionFeedLine,
  postCaptionRequestWords,
  postCaptionTileWords,
} from '../src/features/timeline/post-caption/post-caption-words';
import { activateLocale } from '../src/i18n/i18n';
import {
  author,
  box,
  button,
  CaptionPage,
  captionFake,
  ChatStub,
  status,
  TIMELINE,
  type Send,
} from './post-caption-support';

afterEach(() => {
  const latest = chatSendRequests.latest();
  if (latest) act(() => chatSendRequests.claim(latest.tick));
});

const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
const ui = { source: 'ui', actor: 'user' } as const;
const agent = { source: 'agent', actor: 'agent:run' } as const;

describe('the caption dialog while the chat works (CAP1)', () => {
  it('waits for the chat to take the request, then for the caption, and nothing can be changed meanwhile', async () => {
    await activateLocale('en', 'mac');
    const fake = captionFake();
    const send = vi.fn<Send>();
    const page = (chat: { ready?: boolean; busy?: boolean }) => (
      <CaptionPage fake={fake}>
        <ChatStub send={send} {...chat} />
      </CaptionPage>
    );
    const view = render(page({ ready: false }));
    fireEvent.click(button('Generate with AI'));
    // The chat is still opening: the request waits, and a second press asks nothing more.
    expect(button('Generate with AI').getAttribute('aria-busy')).toBe('true');
    expect(status()).toBe('Sending to the chat…');
    expect(author()).toBe('Taalcut is writing');
    const waiting = chatSendRequests.latest()!.tick;
    fireEvent.click(button('Generate with AI'));
    expect(chatSendRequests.latest()!.tick).toBe(waiting);
    expect(send).not.toHaveBeenCalled();

    // The chat takes it and its run goes: the box is read-only and says who is writing.
    view.rerender(page({ ready: true, busy: true }));
    expect(send).toHaveBeenCalledWith('Write a caption for this video’s Instagram post.', undefined, {
      selections: [],
      postCaption: { platform: 'instagram' },
    });
    expect(status()).toBe('Taalcut is writing your caption. The chat shows its work.');
    expect(button('Generate with AI').disabled).toBe(true);
    expect(box().readOnly).toBe(true);
    expect(box().placeholder).toBe('Taalcut is reading the video and writing its caption…');
    expect(screen.getByRole('switch').getAttribute('aria-disabled')).toBe('true');

    // The run saves the caption (as the tool does, as the agent) and ends: it is in the box, and all is free.
    const timeline = fake.controls.make.timelines.get(TIMELINE)!;
    const target = { projectId: timeline.projectId, timelineId: timeline.id };
    await act(() =>
      fake.controls.make.postCaption.write(
        fake.controls.bus,
        target,
        'instagram',
        fakePostCaptionParts(timeline),
        'agent:run',
      ),
    );
    await waitFor(() => expect(box().value).toContain('Created with @taalcut.app'));
    expect(author()).toBe('Written by Taalcut');
    view.rerender(page({ ready: true, busy: false }));
    await waitFor(() => expect(status()).toBe('Saved with this video.'));
    expect(box().readOnly).toBe(false);
    expect(button('Generate with AI').disabled).toBe(false);
  });

  it('says so when the run ends with no new caption, and can ask again', async () => {
    await activateLocale('en', 'mac');
    const fake = captionFake();
    const send = vi.fn<Send>();
    const page = (busy: boolean) => (
      <CaptionPage fake={fake}>
        <ChatStub send={send} busy={busy} />
      </CaptionPage>
    );
    const view = render(page(false));
    fireEvent.click(button('Generate with AI'));
    view.rerender(page(true));
    expect(status()).toBe('Taalcut is writing your caption. The chat shows its work.');
    view.rerender(page(false));
    await waitFor(() => expect(status()).toBe('No new caption was saved. The chat says why.'));
    expect(author()).toBe('No caption yet');
    expect(box().readOnly).toBe(false);
    fireEvent.click(button('Generate with AI'));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('asks nothing while the chat works on something else, or another request waits there', async () => {
    await activateLocale('en', 'mac');
    const fake = captionFake();
    const send = vi.fn<Send>();
    const page = (busy: boolean) => (
      <CaptionPage fake={fake}>
        <ChatStub send={send} ready={!busy} busy={busy} />
      </CaptionPage>
    );
    const view = render(page(true));
    expect(button('Generate with AI').disabled).toBe(true);
    expect(status()).toBe('Taalcut is working in the chat. You can ask when it is done.');
    expect(box().readOnly).toBe(true);
    const before = chatSendRequests.latest()?.tick ?? 0;
    fireEvent.click(button('Generate with AI'));
    expect(chatSendRequests.latest()?.tick ?? 0).toBe(before);

    act(() => void sendInChat({ text: 'Try again: design this graphic another way.', selections: [] }));
    expect(button('Generate with AI').disabled).toBe(true);
    expect(button('Generate with AI').getAttribute('aria-busy')).toBeNull();
    view.rerender(page(false));
    // The chat takes the other request as it was: no caption on it.
    expect(send).toHaveBeenCalledWith('Try again: design this graphic another way.', undefined, {
      selections: [],
    });
    expect(button('Generate with AI').disabled).toBe(false);
  });
});

describe('the caption panel’s words (CAP1)', () => {
  it('sends "Write a caption for this video’s <platform> post." for every platform of the table', () => {
    // packages/agent/test/editor/post-caption-request.test.ts holds these same words to the Editor's route.
    for (const platform of POST_CAPTION_PLATFORMS)
      expect(postCaptionRequestWords(i18n, platform)).toBe(
        `Write a caption for this video’s ${POST_CAPTION_RULES[platform].name} post.`,
      );
  });

  it('says a video’s caption in a line, and what the feed shows of it', () => {
    expect(postCaptionTileWords(i18n, {})).toBe('Not written yet');
    const kept = (writtenBy: 'ai' | 'person') => ({
      postCaptions: [{ platform: 'instagram' as const, text: 'x', writtenBy }],
    });
    expect(postCaptionTileWords(i18n, kept('ai'))).toBe('Instagram, written by Taalcut');
    expect(postCaptionTileWords(i18n, kept('person'))).toBe('Instagram, edited by you');

    const cut = POST_CAPTION_RULES.instagram.feedCut;
    expect(postCaptionFeedLine('instagram', 'Short hook')).toEqual({ shown: 'Short hook', cut: false });
    expect(postCaptionFeedLine('instagram', 'Hook\n\nMore below')).toEqual({ shown: 'Hook', cut: true });
    const long = postCaptionFeedLine('instagram', 'y'.repeat(cut + 40));
    expect(long).toEqual({ shown: 'y'.repeat(cut), cut: true });
  });
});

describe('post captions in the fake backend (CAP1)', () => {
  it('writes made-up captions that pass the rule they are built by, for every seeded video, twice over', () => {
    const fake = captionFake();
    const all = fake.controls.make.timelines.all();
    expect(all.length).toBeGreaterThan(3);
    for (const timeline of all) {
      const first = fakePostCaptionParts(timeline);
      const built = buildPostCaption('instagram', first, { credit: true });
      expect(built.issues, timeline.name).toEqual([]);
      // Asked again, it opens another way.
      const kept = {
        ...timeline,
        postCaptions: [{ platform: 'instagram' as const, text: built.text, writtenBy: 'ai' as const }],
      };
      const second = fakePostCaptionParts(kept);
      expect(second.body).not.toBe(first.body);
      expect(buildPostCaption('instagram', second, { credit: false }).issues, timeline.name).toEqual([]);
    }
  });

  it('keeps the caption on the video as the real command does: whose it is, one undo step, nothing else moved', async () => {
    const fake = captionFake();
    const { bus, make } = fake.controls;
    const before = structuredClone(make.timelines.get(TIMELINE)!);
    const target = { projectId: before.projectId, timelineId: before.id, platform: 'instagram' };
    const set = (text: string | null, origin: typeof ui | typeof agent = ui) =>
      bus.dispatch(POST_CAPTION_COMMAND, { ...target, text }, origin);

    const saved = await set('Taalcut’s words', agent);
    expect(saved.ok && saved.value.result).toMatchObject({
      timelineId: before.id,
      revision: before.revision + 1,
      platform: 'instagram',
      text: 'Taalcut’s words',
    });
    const { postCaptions, revision: _now, updatedAt: _at, ...rest } = make.timelines.get(TIMELINE)!;
    const { revision: _was, updatedAt: _then, ...was } = before;
    expect(postCaptions).toEqual([{ platform: 'instagram', text: 'Taalcut’s words', writtenBy: 'ai' }]);
    expect(rest).toEqual(was);

    // A person's text is kept however it breaks the rule; the same text again writes nothing.
    expect((await set('mine #a #b #c #d #e #f')).ok).toBe(true);
    expect(make.timelines.get(TIMELINE)!.postCaptions?.[0]).toMatchObject({ writtenBy: 'person' });
    const revision = make.timelines.get(TIMELINE)!.revision;
    await set('mine #a #b #c #d #e #f');
    expect(make.timelines.get(TIMELINE)!.revision).toBe(revision);

    expect((await bus.undo(before.projectId, ui)).ok).toBe(true);
    expect(make.timelines.get(TIMELINE)!.postCaptions).toEqual([
      { platform: 'instagram', text: 'Taalcut’s words', writtenBy: 'ai' },
    ]);
    expect((await bus.undo(before.projectId, ui)).ok).toBe(true);
    expect(make.timelines.get(TIMELINE)!.postCaptions).toBeUndefined();

    // The credit switch is a person's: the fake's bus refuses the agent as the app's does.
    const refused = await bus.dispatch(POST_CAPTION_SETTING_COMMANDS.setCredit, { enabled: false }, agent);
    expect(refused).toMatchObject({ ok: false, error: { code: 'core.command_source_refused' } });
  });
});
