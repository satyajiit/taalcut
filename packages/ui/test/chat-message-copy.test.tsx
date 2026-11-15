// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Your own message carries a compact Copy under its bubble, so the same words can start another chat: it puts the
// words on the clipboard exactly as written, says "Copied" for a moment, says so when the clipboard refuses, and
// never shows under the agent's words or under a message with no words.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatMessage } from '../src/index';

const ASK = 'lets do one from https://example.com/reel/EXAMPLE789/?a=1&b=2\n  second line ';

const show = (node: React.ReactNode) => render(<I18nProvider i18n={i18n}>{node}</I18nProvider>);
const clipboard = (writeText: (text: string) => Promise<void>) =>
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
const mine = () => document.querySelector<HTMLElement>('[data-slot=chat-message][data-role=user]')!;

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('copying your own message', () => {
  it('copies the words exactly as written, says Copied, then offers Copy again', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => Promise.resolve());
    clipboard(writeText);
    show(<ChatMessage role="user" text={ASK} />);

    const copy = within(mine()).getByRole('button', { name: 'Copy' });
    // Under the bubble, not inside it.
    expect(copy.closest('[data-slot=chat-bubble]')).toBeNull();
    await act(async () => {
      fireEvent.click(copy);
    });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(ASK);
    expect(within(mine()).getByRole('button', { name: 'Copied' })).toBeDefined();
    expect(screen.getByRole('status').textContent).toBe('Copied');

    act(() => {
      vi.advanceTimersByTime(2_600);
    });
    expect(within(mine()).getByRole('button', { name: 'Copy' })).toBeDefined();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('says so when the clipboard refuses, and a second try can still work', async () => {
    const writeText = vi
      .fn<(text: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce();
    clipboard(writeText);
    show(<ChatMessage role="user" text="Make it calmer" />);

    await act(async () => {
      fireEvent.click(within(mine()).getByRole('button', { name: 'Copy' }));
    });
    const failed = within(mine()).getByRole('button', { name: 'Couldn’t copy' });
    await act(async () => {
      fireEvent.click(failed);
    });
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(within(mine()).getByRole('button', { name: 'Copied' })).toBeDefined();
  });

  it('says it could not copy where there is no clipboard at all', async () => {
    show(<ChatMessage role="user" text="Make it calmer" />);
    await act(async () => {
      fireEvent.click(within(mine()).getByRole('button', { name: 'Copy' }));
    });
    expect(within(mine()).getByRole('button', { name: 'Couldn’t copy' })).toBeDefined();
  });

  it('stays with a message that was not sent, beside its footer', () => {
    show(<ChatMessage role="user" text="Make it calmer" footer="Not sent" />);
    expect(within(mine()).getByText('Not sent')).toBeDefined();
    expect(within(mine()).getByRole('button', { name: 'Copy' })).toBeDefined();
  });

  it('is not offered under the agent’s words or under a message with no words', () => {
    show(
      <>
        <ChatMessage role="agent" text="Here is your video." />
        <ChatMessage role="user" text="   " attachments={<span>clip 3</span>} />
      </>,
    );
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
  });
});
