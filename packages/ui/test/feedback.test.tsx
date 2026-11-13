// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { TaalcutError } from '@taalcut/core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  createLoadingTracker,
  createToastStore,
  ErrorCard,
  GlobalLoader,
  localStorageAcknowledgementStore,
  memoryAcknowledgementStore,
  Toaster,
  toastStore,
  WarningCard,
} from '../src/index';

const wrap = (node: ReactNode) => render(<I18nProvider i18n={i18n}>{node}</I18nProvider>);

const timeout: TaalcutError = {
  code: 'core.timeout',
  messageKey: 'errors.core.timeout',
  retryable: true,
  fix: { command: 'agent.retryStep', labelKey: 'fix.retry', payload: { step: 2 } },
};

describe('ErrorCard', () => {
  it('names the cause and runs the one fix with its payload', () => {
    const onFix = vi.fn();
    wrap(<ErrorCard error={timeout} onFix={onFix} />);
    // The cause's first sentence is the title, the rest its body.
    expect(screen.getByText('This took too long and was stopped.').className).toContain('font-bold');
    expect(screen.getByText('Try again.')).toBeTruthy();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onFix).toHaveBeenCalledWith(timeout.fix);
  });

  it('shows the generic message for a code with no words yet, and no button without a fix', () => {
    wrap(
      <ErrorCard
        error={{ code: 'media.new_thing', messageKey: 'errors.media.new_thing', retryable: false }}
      />,
    );
    expect(screen.getByRole('alert')?.textContent).toContain('Something went wrong.');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says in plain words when ChatGPT, or any provider, doesn’t take the model', () => {
    const refused = (params: TaalcutError['params']): TaalcutError => ({
      code: 'models.unknown_model',
      messageKey: 'errors.models.unknown_model',
      retryable: false,
      params,
    });
    const { rerender } = wrap(
      <ErrorCard error={refused({ provider: 'openai', model: 'gpt-6.1-sol', via: 'chatgpt' })} />,
    );
    // The card sets the cause and the next step apart.
    expect(screen.getByRole('alert').textContent).toContain('ChatGPT didn’t accept the model gpt-6.1-sol.');
    expect(screen.getByRole('alert').textContent).toContain('Pick another in Settings › Models.');
    rerender(
      <I18nProvider i18n={i18n}>
        <ErrorCard error={refused({ provider: 'anthropic', model: 'claude-sonnet-5-5' })} />
      </I18nProvider>,
    );
    expect(screen.getByRole('alert').textContent).toContain('The model claude-sonnet-5-5 isn’t available.');
  });

  it('offers a retry for a retryable error without a fix', () => {
    const onRetry = vi.fn();
    wrap(<ErrorCard error={{ ...timeout, fix: undefined }} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('labels an unknown fix "Fix it" and keeps developer detail hidden by default', () => {
    const error = { ...timeout, detail: 'stack', fix: { command: 'x.y', labelKey: 'fix.unknownThing' } };
    const { rerender } = wrap(<ErrorCard error={error} onFix={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Fix it' })).toBeTruthy();
    expect(screen.queryByText(/stack/)).toBeNull();
    rerender(
      <I18nProvider i18n={i18n}>
        <ErrorCard error={error} onFix={() => undefined} showDetail />
      </I18nProvider>,
    );
    expect(screen.getByText(/stack/)).toBeTruthy();
  });
});

describe('ErrorCard fix outcome', () => {
  it('folds into one quiet line when the fix worked: no toast (success is silent)', async () => {
    const before = toastStore.list().length;
    wrap(<ErrorCard error={timeout} onFix={async () => ({ ok: true, value: null })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Try again: done'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(toastStore.list().length).toBe(before);
  });

  it("adds a follow-up error card when the fix fails, with that error's own fix", async () => {
    const onFix = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: 'core.not_found',
        messageKey: 'errors.core.not_found',
        retryable: false,
        fix: { command: 'sources.choose', labelKey: 'fix.chooseFolder' },
      },
    }));
    wrap(<ErrorCard error={timeout} onFix={onFix} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    expect(screen.getAllByRole('alert')[1]?.textContent).toContain('That is no longer here.');
    fireEvent.click(screen.getByRole('button', { name: 'Choose another folder' }));
    expect(onFix).toHaveBeenLastCalledWith({ command: 'sources.choose', labelKey: 'fix.chooseFolder' });
  });
});

describe('WarningCard', () => {
  const props = {
    topic: 'audio.keepReference',
    title: 'Keep the reference audio?',
    risk: 'The video can be muted or blocked.',
    bearer: 'You, as the account owner.',
  };

  it('needs "I understand" once per terms version, then shows what it guards', async () => {
    const store = memoryAcknowledgementStore(() => 42);
    const onAcknowledged = vi.fn();
    const safer = vi.fn();
    const { unmount } = wrap(
      <WarningCard
        {...props}
        termsVersion="1"
        store={store}
        saferAlternative={{ label: 'Export without the audio', onSelect: safer }}
        onAcknowledged={onAcknowledged}
      >
        <p>Guarded</p>
      </WarningCard>,
    );
    expect(await screen.findByRole('region', { name: 'Keep the reference audio?' })).toBeTruthy();
    expect(screen.getByText('What could happen')).toBeTruthy();
    expect(screen.getByText('Who bears the risk')).toBeTruthy();
    expect(screen.queryByText('Guarded')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Export without the audio' }));
    expect(safer).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'I understand' }));
    expect(await screen.findByText('Guarded')).toBeTruthy();
    expect(onAcknowledged).toHaveBeenCalledWith({
      topic: props.topic,
      termsVersion: '1',
      acknowledgedAt: 42,
    });
    unmount();

    // Same terms: no card. New terms: the card again.
    const second = wrap(
      <WarningCard
        {...props}
        termsVersion="1"
        store={store}
        saferAlternative={{ label: 'Safer', onSelect: safer }}
      >
        <p>Guarded</p>
      </WarningCard>,
    );
    expect(await screen.findByText('Guarded')).toBeTruthy();
    second.unmount();
    wrap(
      <WarningCard
        {...props}
        termsVersion="2"
        store={store}
        saferAlternative={{ label: 'Safer', onSelect: safer }}
      >
        <p>Guarded</p>
      </WarningCard>,
    );
    expect(await screen.findByRole('button', { name: 'I understand' })).toBeTruthy();
    expect(store.list()).toHaveLength(1);
  });

  it('puts focus on the card, or on "I understand" when that is the one press left', async () => {
    const shown = (autoFocus: true | 'acknowledge') =>
      wrap(
        <WarningCard
          {...props}
          termsVersion="1"
          store={memoryAcknowledgementStore()}
          saferAlternative={{ label: 'Safer', onSelect: () => undefined }}
          autoFocus={autoFocus}
        />,
      );
    const card = shown(true);
    const region = await screen.findByRole('region', { name: 'Keep the reference audio?' });
    expect(document.activeElement).toBe(region);
    card.unmount();
    shown('acknowledge');
    const acknowledge = await screen.findByRole('button', { name: 'I understand' });
    expect(document.activeElement).toBe(acknowledge);
  });

  it('stores acknowledgements in localStorage and keeps the first record', async () => {
    let now = 1;
    const store = localStorageAcknowledgementStore(window.localStorage, 'acks', () => now++);
    expect(await store.has('a', '1')).toBe(false);
    const first = await store.record({ topic: 'a', termsVersion: '1', context: { account: 'x' } });
    const again = await store.record({ topic: 'a', termsVersion: '1' });
    expect(again).toEqual(first);
    expect(await store.has('a', '1')).toBe(true);
    expect(await store.has('a', '2')).toBe(false);
    expect(JSON.parse(window.localStorage.getItem('acks') ?? '[]')).toHaveLength(1);
  });
});

describe('global loader and toasts', () => {
  it('tracks pending work', async () => {
    const tracker = createLoadingTracker();
    let resolve: () => void = () => undefined;
    const work = tracker.track(new Promise<void>((r) => (resolve = r)));
    expect(tracker.pending()).toBe(1);
    resolve();
    await work;
    await Promise.resolve();
    expect(tracker.pending()).toBe(0);
  });

  it('shows an indeterminate progress bar only while active', () => {
    const { rerender } = wrap(<GlobalLoader active={false} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    rerender(
      <I18nProvider i18n={i18n}>
        <GlobalLoader active />
      </I18nProvider>,
    );
    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeTruthy();
  });

  it('shows toasts from anywhere, with one action, and closes them', async () => {
    const store = createToastStore();
    const undo = vi.fn();
    wrap(<Toaster store={store} />);
    act(() => {
      store.show({ title: 'Clip removed', tone: 'success', action: { label: 'Undo', onSelect: undo } });
    });
    expect(await screen.findByText('Clip removed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledOnce();
    // The action closes its toast.
    await waitFor(() => expect(store.list().every((entry) => !entry.open)).toBe(true));

    act(() => {
      store.show({ title: 'Saved' });
    });
    expect(await screen.findByText('Saved')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(store.list().every((entry) => !entry.open)).toBe(true));
  });
});
