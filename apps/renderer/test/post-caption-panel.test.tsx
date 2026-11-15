// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CAP1: the caption dialog against the fake backend. "Generate with AI" asks the chat with the platform and the
 * note as data, and the caption the run saves appears; it is the video's, so it shows again on every opening; a
 * person's own text is flagged against the platform's rule and saved as it is; Copy puts what is shown on the
 * clipboard; the credit switch is remembered and decides whether the line is there.
 */
import { chatContract, POST_CAPTION_SETTING_COMMANDS, postCaptionRequestSchema } from '@taalcut/core';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatSendRequests } from '../src/features/timeline/dock/chat-requests';
import { author, box, button, captionFake, flags, mountCaption, status } from './post-caption-support';

const CREDIT = 'Created with @taalcut.app';
const note = () => screen.getByLabelText('What should the caption say? (optional)') as HTMLInputElement;
const credit = () => screen.getByRole('switch', { name: `Add “${CREDIT}”` });
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });

afterEach(() => {
  const latest = chatSendRequests.latest();
  if (latest) act(() => chatSendRequests.claim(latest.tick));
  vi.unstubAllGlobals();
});

/** Asks for a caption and waits until the one Taalcut saved is in the box. */
async function generated(view: Awaited<ReturnType<typeof mountCaption>>) {
  fireEvent.click(button('Generate with AI'));
  await waitFor(() => expect(view.saved()?.[0]?.writtenBy).toBe('ai'));
  await waitFor(() => expect(author()).toBe('Written by Taalcut'));
  await waitFor(() => expect(status()).toBe('Saved with this video.'));
  return view.saved()![0]!.text;
}

describe('the caption dialog (CAP1)', () => {
  it('starts with none, says the platform’s rule from the table, and has one primary: Generate with AI', async () => {
    await mountCaption();
    expect(screen.getByRole('dialog', { name: 'Post caption' })).toBeTruthy();
    // One platform in the rule table: it is named with its rule, not offered as a choice of one.
    expect(document.querySelector('[data-slot="post-caption-platform"]')?.textContent).toBe(
      'Instagram1 to 4 hashtags · search phrases in brackets at the end · up to 2,200 characters',
    );
    expect(screen.queryByRole('radiogroup')).toBeNull();
    // The caret starts in the caption.
    expect(document.activeElement).toBe(box());
    expect(
      screen.getByText('1 to 4 hashtags · search phrases in brackets at the end · up to 2,200 characters'),
    ).toBeTruthy();
    expect(author()).toBe('No caption yet');
    expect(box().value).toBe('');
    expect(status()).toBe('Taalcut writes it in the chat and saves it here.');
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(flags()).toEqual([]);
    await waitFor(() => expect(credit().getAttribute('aria-checked')).toBe('true'));
  });

  it('asks the chat with the platform and the note as data, and shows the caption Taalcut saves', async () => {
    const view = await mountCaption();
    fireEvent.change(note(), { target: { value: '  Mention the lanterns  ' } });
    const text = await generated(view);

    expect(view.sent).toHaveBeenCalledTimes(1);
    const message = view.sent.mock.calls[0]![0];
    expect(message.text).toBe('Write a caption for this video’s Instagram post. Mention the lanterns');
    expect(message.postCaption).toEqual({ platform: 'instagram', note: 'Mention the lanterns' });
    // The request is one the chat contract takes as it is.
    expect(postCaptionRequestSchema.safeParse(message.postCaption).success).toBe(true);
    expect(chatContract.send['~orpc'].inputSchema?.safeParse(message).success).toBe(true);

    // What the run saved is in the box, in the platform's order, and nothing in it is flagged.
    expect(box().value).toBe(text);
    const blocks = text.split('\n\n');
    expect(blocks.at(-3)).toBe(CREDIT);
    expect(blocks.at(-2)).toMatch(/^#\S+( #\S+){0,3}$/u);
    expect(blocks.at(-1)).toMatch(/^\(.+, .+, .+\)$/u);
    expect(flags()).toEqual([]);
    expect(view.saved()).toEqual([{ platform: 'instagram', text, writtenBy: 'ai' }]);
    expect(document.querySelector('[data-slot="post-caption-feed"]')?.textContent).toContain(
      text.split('\n')[0]!.slice(0, 40),
    );
    // Now there is something to copy, so Copy is the primary; asking again writes another.
    expect(button('Copy')).toBeTruthy();
    const again = await (async () => {
      fireEvent.click(button('Generate with AI'));
      await waitFor(() => expect(view.saved()![0]!.text).not.toBe(text));
      return view.saved()![0]!.text;
    })();
    await waitFor(() => expect(box().value).toBe(again));
  });

  it('shows the saved caption again when the dialog is reopened, and when the editor is opened again', async () => {
    const view = await mountCaption();
    const text = await generated(view);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(button('open the caption'));
    expect(box().value).toBe(text);
    expect(author()).toBe('Written by Taalcut');

    // It is the video's, not the dialog's: another mount over the same backend has it too.
    view.view.unmount();
    await mountCaption(view.fake);
    expect(box().value).toBe(text);
    expect(status()).toBe('Saved with this video.');
  });

  it('flags a person’s own text against the rule as they type, and saves it as it is', async () => {
    const view = await mountCaption();
    await waitFor(() => expect(credit().getAttribute('aria-disabled')).not.toBe('true'));
    const own = 'Lanterns over the old quarter #a #b #c #d #e #f';
    type(own);
    expect(author()).toBe('Your edit, not saved yet');
    expect(flags()).toEqual([
      '6 hashtags, and Instagram takes 4 at most.',
      'No search phrases in brackets at the very end, like (first phrase, second phrase).',
      `The line “${CREDIT}” is switched on, and it is not in this text.`,
    ]);
    expect(screen.getByText('You can still save and copy it as it is.')).toBeTruthy();
    expect(status()).toBe('Not saved yet. It is saved when you copy it or close this.');

    fireEvent.click(button('Save'));
    await waitFor(() =>
      expect(view.saved()).toEqual([{ platform: 'instagram', text: own, writtenBy: 'person' }]),
    );
    await waitFor(() => expect(author()).toBe('Edited by you'));
    // Saved, and still said: a flag is not a refusal.
    expect(flags()).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();

    // Fewer phrases than the rule, a repeated credit, and a text over the length: each in its own words.
    type(`One line\n\n${CREDIT}\n${CREDIT}\n\n#a\n\n(only one)`);
    expect(flags()).toEqual([
      '1 search phrase in the brackets. At least 3 help people find the post.',
      `The line “${CREDIT}” is in the text 2 times.`,
    ]);
    type(`${'x'.repeat(2300)} #a (one, two, three)`);
    expect(document.querySelector('[data-slot="post-caption-count"]')?.textContent).toBe('2,321 of 2,200');
    expect(flags()).toEqual([
      `The line “${CREDIT}” is switched on, and it is not in this text.`,
      '121 characters over Instagram’s 2,200.',
    ]);
  });

  it('keeps an unsaved edit when the dialog closes, and leaves a caption alone when the box was only emptied', async () => {
    const view = await mountCaption();
    const text = await generated(view);
    type(`${text}\n\nSee you there.`);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(view.saved()![0]).toMatchObject({ writtenBy: 'person' }));
    const kept = view.saved()![0]!.text;
    expect(kept).toBe(`${text}\n\nSee you there.`);

    fireEvent.click(button('open the caption'));
    type('');
    expect(status()).toBe('Save to take the caption off this video, or close to keep it.');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(button('open the caption'));
    expect(box().value).toBe(kept);
    // Save on an empty box is how a caption is taken off the video.
    type('');
    fireEvent.click(button('Save'));
    await waitFor(() => expect(view.saved()).toBeUndefined());
    expect(author()).toBe('No caption yet');
  });

  it('copies what is shown, by the clipboard route the chat’s Copy uses, and keeps what was copied', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const view = await mountCaption();
    const text = await generated(view);
    fireEvent.click(button('Copy'));
    expect(writeText).toHaveBeenCalledWith(text);
    await waitFor(() => expect(button('Copied')).toBeTruthy());

    // An edit is copied as typed (trimmed), and saved by the same press.
    type(`${text}\n\nSee you there.  `);
    fireEvent.click(screen.getByRole('button', { name: /Cop/u }));
    expect(writeText).toHaveBeenLastCalledWith(`${text}\n\nSee you there.`);
    await waitFor(() =>
      expect(view.saved()).toEqual([
        { platform: 'instagram', text: `${text}\n\nSee you there.`, writtenBy: 'person' },
      ]),
    );

    // A clipboard that refuses says so on the button.
    writeText.mockImplementationOnce(() => Promise.reject(new Error('denied')));
    fireEvent.click(screen.getByRole('button', { name: /Cop/u }));
    await waitFor(() => expect(button('Couldn’t copy')).toBeTruthy());
  });

  it('adds the credit line by a remembered switch that only a person’s command turns', async () => {
    const view = await mountCaption();
    const text = await generated(view);
    expect(text).toContain(`\n\n${CREDIT}\n\n`);

    fireEvent.click(credit());
    expect(credit().getAttribute('aria-checked')).toBe('false');
    // The text in the box follows the switch at once; it is an edit like any other until it is saved.
    expect(box().value).toBe(text.replace(`${CREDIT}\n\n`, ''));
    expect(flags()).toEqual([]);
    await waitFor(() =>
      expect(view.fake.controls.dispatched).toContainEqual({
        name: POST_CAPTION_SETTING_COMMANDS.setCredit,
        source: 'ui',
      }),
    );
    expect(await view.fake.client.postCaption.credit()).toEqual({ enabled: false });

    // Taalcut's next caption comes without the line: the tool reads the switch, the model never decides it.
    await waitFor(() => expect(button('Generate with AI').disabled).toBe(false));
    fireEvent.click(button('Generate with AI'));
    await waitFor(() => expect(view.saved()![0]).toMatchObject({ writtenBy: 'ai' }));
    await waitFor(() => expect(box().value).not.toContain('@taalcut.app'));
    expect(view.saved()![0]!.text).not.toContain('@taalcut.app');

    // Remembered: the next opening of the editor finds it off; back on, the line returns to the text.
    view.view.unmount();
    await mountCaption(view.fake);
    await waitFor(() => expect(credit().getAttribute('aria-checked')).toBe('false'));
    await waitFor(() => expect(credit().getAttribute('aria-disabled')).not.toBe('true'));
    fireEvent.click(credit());
    expect(box().value).toContain(`\n\n${CREDIT}\n\n#`);
    expect(
      view.fake.controls.dispatched.filter((each) => each.source !== 'ui' && each.source !== 'agent'),
    ).toEqual([]);
  });

  it('opens on a fresh backend with the credit on', async () => {
    const fake = captionFake();
    expect(await fake.client.postCaption.credit()).toEqual({ enabled: true });
  });
});
