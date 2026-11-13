// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX round 1 (W2-5): a card's watch that breaks is a cause with Try again, never "This was deleted."; a failed
// answer keeps the card open with Try again; one marigold primary in a transcript; the consent card names the step
// in words; the composer holds a message while the chat can't take it.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { CardOf, RenderSnapshot, TaalcutError } from '@taalcut/core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CARD_FIXTURES,
  CardActionsProvider,
  CardView,
  Composer,
  MAKE_FIXTURE_IDS,
  MAKE_FIXTURES,
  PrimaryHolderProvider,
  type CardData,
} from '../src/index';
import { RATE, wrap } from './make-fixture';

const answered = { ok: true as const, value: 'answered' as const };
const restarted: TaalcutError = {
  code: 'core.process_restarted',
  messageKey: 'errors.core.process_restarted',
  retryable: true,
};
const { project: PROJECT, timeline: TIMELINE, render: RENDER } = MAKE_FIXTURE_IDS;

const snapshot: RenderSnapshot = {
  id: RENDER,
  projectId: PROJECT,
  timelineId: TIMELINE,
  timelineRevision: 3,
  presetId: 'reels',
  status: 'rendering',
  jobId: null,
  progress: { fraction: 0.42, stageKey: 'render.stage.capturing', etaMs: 38_000 },
  name: 'Golden hour market',
  width: 1080,
  height: 1920,
  rate: RATE,
  durationFrames: 450,
  bytes: null,
  music: 'platformSound',
  captions: { burnIn: true, sidecars: [] },
  qa: null,
  supersedes: null,
  notify: false,
  error: null,
  credentials: { added: false, state: null },
  batchId: null,
  createdAt: 0,
  finishedAt: null,
  deletedAt: null,
};

describe('a card whose watch breaks', () => {
  const card = MAKE_FIXTURES.renderProgress.rendering;

  it('keeps the export as last seen, with Cancel, and says why with Try again', async () => {
    const watchRender = vi.fn<NonNullable<CardData['watchRender']>>((_id, onChange, onError) => {
      onChange(snapshot);
      onError?.(restarted);
      return () => undefined;
    });
    wrap(<CardView card={card} />, { dispatch: vi.fn() }, { watchRender });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.queryByText('This was deleted.')).toBeNull();
    const again = screen.getByRole('button', { name: 'Try again' });
    await act(async () => fireEvent.click(again));
    expect(watchRender).toHaveBeenCalledTimes(2);
  });

  it('says it was deleted only when it was', () => {
    const watchRender: CardData['watchRender'] = (_id, onChange) => {
      onChange(null);
      return () => undefined;
    };
    wrap(<CardView card={card} />, {}, { watchRender });
    expect(screen.getByText('This export was deleted.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});

describe('a failed answer', () => {
  it('keeps the card open with the cause and Try again, which sends the same answer', async () => {
    const decide = vi
      .fn()
      .mockResolvedValueOnce({ ok: false as const, error: restarted })
      .mockResolvedValueOnce(answered);
    wrap(<CardView card={CARD_FIXTURES.approval.pending!} />, { decide });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Go ahead' })));
    // Not settled: the question is still there to answer, and the failure says so on the card.
    expect(screen.getByRole('button', { name: 'Go ahead' })).toBeTruthy();
    const again = screen.getByRole('button', { name: 'Try again' });
    await act(async () => fireEvent.click(again));
    expect(decide).toHaveBeenCalledTimes(2);
    expect(decide).toHaveBeenLastCalledWith('ap-1', 'approve');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull());
  });
});

describe('a failed answer on a card that settles another way', () => {
  it('goes with the question: a new message answered it "Not now", so there is nothing to retry', async () => {
    const card = CARD_FIXTURES.approval.pending!;
    const decide = vi.fn().mockResolvedValue({ ok: false as const, error: restarted });
    const view = wrap(<CardView card={card} />, { decide });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Go ahead' })));
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    view.rerender(
      <I18nProvider i18n={i18n}>
        <CardActionsProvider value={{ decide }}>
          <CardView card={{ ...card, status: 'denied' }} />
        </CardActionsProvider>
      </I18nProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});

describe('one marigold primary in a transcript', () => {
  const older: CardOf<'approval'> = { ...CARD_FIXTURES.approval.pending!, id: 'older', approvalId: 'ap-old' };
  const newer: CardOf<'approval'> = { ...CARD_FIXTURES.approval.pending!, id: 'newer', approvalId: 'ap-new' };

  it('the holder fills its main action; an older question shows it as secondary, and no "Waiting" chip', () => {
    const { container } = wrap(
      <PrimaryHolderProvider holder="newer">
        <CardView card={older} />
        <CardView card={newer} />
      </PrimaryHolderProvider>,
      { decide: vi.fn().mockResolvedValue(answered) },
    );
    const buttons = screen.getAllByRole('button', { name: 'Go ahead' });
    expect(buttons.map((button) => button.className.includes('bg-primary'))).toEqual([false, true]);
    expect(container.textContent).not.toContain('Waiting for you');
  });

  it('outside a transcript each card keeps its own', () => {
    wrap(<CardView card={older} />, { decide: vi.fn().mockResolvedValue(answered) });
    expect(screen.getByRole('button', { name: 'Go ahead' }).className).toContain('bg-primary');
  });
});

describe('the consent card', () => {
  it('names the step in words and the file by name, then what it costs', () => {
    const { container } = wrap(<CardView card={CARD_FIXTURES.consent.pending!} />, {
      decide: vi.fn().mockResolvedValue(answered),
    });
    expect(container.textContent).toContain('Describing IMG_0418.MOV sends one frame of it to Google.');
    expect(container.textContent).not.toContain('Look at a frame sends');
  });
});

describe('the composer while the chat can’t take a message', () => {
  it('keeps the words, sends nothing and says why after a try', () => {
    const onSend = vi.fn();
    render(
      <I18nProvider i18n={i18n}>
        <Composer busy={false} hold="This chat is still opening." onSend={onSend} onStop={() => undefined} />
      </I18nProvider>,
    );
    const box = screen.getByRole('textbox', { name: 'Message Taalcut' });
    fireEvent.change(box, { target: { value: 'Make it shorter' } });
    expect(screen.queryByText('This chat is still opening.')).toBeNull();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    expect((box as HTMLTextAreaElement).value).toBe('Make it shorter');
    expect(screen.getByRole('status').textContent).toBe('This chat is still opening.');
  });
});
