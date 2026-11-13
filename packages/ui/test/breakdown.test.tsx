// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { CardOf, Template } from '@taalcut/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BeatWaveform,
  CardActionsProvider,
  CardDataProvider,
  CardView,
  CARD_FIXTURES,
  type CardActions,
  type CardData,
} from '../src/index';
import { templateFixture } from './template-fixture';

// The kit imports only types from core (dependency-cruiser): a Result by hand.
const ok = <T,>(value: T) => ({ ok: true as const, value });

const wrap = (node: ReactNode) => render(<I18nProvider i18n={i18n}>{node}</I18nProvider>);

const base = (template: Template) => ({
  projectId: null,
  templateId: template.id,
  baseVersion: template.version,
});

describe('beat waveform', () => {
  const calls: string[] = [];
  const context = new Proxy(
    {},
    {
      get: (_target, name) =>
        name === 'canvas' ? undefined : (..._args: unknown[]) => calls.push(String(name)),
      set: () => true,
    },
  ) as CanvasRenderingContext2D;

  afterEach(() => {
    calls.length = 0;
    vi.restoreAllMocks();
  });

  it('draws once it has a size, and again when the theme changes (colours come from the tokens)', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(320);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(56);
    wrap(<BeatWaveform template={templateFixture()} />);
    await waitFor(() => expect(calls.filter((name) => name === 'clearRect')).toHaveLength(1));
    // A slot cut is a hairline and every beat a tick: fillRect for each.
    expect(calls.filter((name) => name === 'fillRect').length).toBeGreaterThan(10);
    act(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await waitFor(() => expect(calls.filter((name) => name === 'clearRect')).toHaveLength(2));
  });
});

describe('domain cards', () => {
  const ready = (template: Template): CardOf<'breakdown'> => ({
    ...CARD_FIXTURES.breakdown.analysing!,
    stage: 'ready',
    progress: null,
    template: { id: template.id, version: template.version },
  });

  function card(node: ReactNode, actions: CardActions, data: CardData = {}) {
    return wrap(
      <CardActionsProvider value={actions}>
        <CardDataProvider value={data}>{node}</CardDataProvider>
      </CardActionsProvider>,
    );
  }

  it('breakdown: a summary of the live template, Approve as it is in one command, and it follows changes', async () => {
    let current = templateFixture();
    const listeners = new Set<() => void>();
    const data: CardData = {
      template: async () => ({
        summary: { projectId: null, name: 'Chai', media: null } as never,
        template: current,
        changedBy: null,
      }),
      watchTemplate: (_id, onChange) => {
        listeners.add(onChange);
        return () => listeners.delete(onChange);
      },
    };
    const dispatch = vi.fn(async () => ok(null));
    const navigate = vi.fn();
    card(<CardView card={ready(current)} />, { dispatch, navigate }, data);
    await screen.findByRole('button', { name: 'Review the reel' });
    expect(screen.getByText('4 slots')).toBeTruthy();
    expect(screen.getByText('120 beats a minute')).toBeTruthy();
    expect(screen.getByText('Taalcut is sure of every cut. Watch it once before you approve.')).toBeTruthy();

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Approve as it is' })));
    expect(dispatch).toHaveBeenCalledWith('template.slot.approve', {
      ...base(current),
      slotIds: current.slots.filter((slot) => !slot.approved).map((slot) => slot.id),
      approved: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open the template' }));
    expect(navigate).toHaveBeenCalledWith({ to: 'template', templateId: current.id });

    // ⌘Z elsewhere, or an edit on the page: the card reads the new head.
    current = templateFixture({
      version: 2,
      slots: current.slots.map((slot) => ({ ...slot, approved: true })),
    });
    await act(async () => listeners.forEach((listener) => listener()));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Approved');
    expect(screen.queryByRole('button', { name: 'Approve as it is' })).toBeNull();
  });

  it('breakdown: says what is left to check, and Review the reel opens the review over the chat', async () => {
    const base = templateFixture();
    const current: Template = {
      ...base,
      slots: base.slots.map((slot, i) => (i === 2 ? { ...slot, doubts: [{ reason: 'cutUnsure' }] } : slot)),
    };
    const data: CardData = {
      template: async () => ({
        summary: { projectId: null, name: 'Chai', media: null } as never,
        template: current,
        changedBy: null,
      }),
      templateReel: () => null,
    };
    card(<CardView card={ready(current)} />, { dispatch: vi.fn(async () => ok(null)) }, data);
    expect(await screen.findByText('1 to check: 1 cut Taalcut isn’t sure of.')).toBeTruthy();
    const opener = screen.getByRole('button', { name: 'Review the reel' });
    opener.focus();
    fireEvent.click(opener);
    const sheet = await screen.findByRole('dialog', { name: 'Review the reel: Chai' });
    expect(within(sheet).getByRole('heading', { name: 'Slot 3 of 4: The pour' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Focus goes back to the button that opened it (2.4.3).
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('breakdown: every slot approved says so, with a line still open under it', async () => {
    const base = templateFixture();
    const current: Template = {
      ...base,
      slots: base.slots.map((slot) => ({ ...slot, approved: true })),
      text: [{ ...base.text[0]!, doubts: [{ reason: 'textMaybeScene' }] }, ...base.text.slice(1)],
    };
    const data: CardData = {
      template: async () => ({
        summary: { projectId: null, name: 'Chai', media: null } as never,
        template: current,
        changedBy: null,
      }),
      templateReel: () => null,
    };
    card(<CardView card={ready(current)} />, { dispatch: vi.fn(async () => ok(null)) }, data);
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Approved');
    expect(screen.getByText('1 still to check: 1 line of text that may be part of the scene.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve as it is' })).toBeNull();
  });

  it('breakdown: while reading, steps say where it is, with a neutral bar', () => {
    card(<CardView card={CARD_FIXTURES.breakdown.analysing!} />, {});
    expect(
      screen.getByRole('progressbar', { name: 'Reading the reference' }).getAttribute('aria-valuenow'),
    ).toBe('40');
    const running = document.querySelector('[data-state=running]');
    expect(running?.textContent).toContain('Finding the beats');
  });

  it('source picker: Add folder opens the folder dialog, then adds it as a command', async () => {
    const pickFolder = vi.fn(async () => ok({ path: '/Users/me/Movies/Goa' }));
    const dispatch = vi.fn(async () => ok({ sourceId: 'x' }));
    card(<CardView card={CARD_FIXTURES.sourcePicker.empty!} />, { pickFolder, dispatch, navigate: vi.fn() });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add folder' })));
    expect(dispatch).toHaveBeenCalledWith('library.addSource', { path: '/Users/me/Movies/Goa' });
    expect(screen.getByRole('status').textContent).toBe('Added Goa');
  });

  it('source picker: a cancelled dialog changes nothing', async () => {
    const dispatch = vi.fn(async () => ok(null));
    card(<CardView card={CARD_FIXTURES.sourcePicker.empty!} />, {
      pickFolder: async () => ok(null),
      dispatch,
    });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add folder' })));
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('import progress: pause is scheduling, not a command', async () => {
    const pause = vi.fn(async () => ok(null));
    card(<CardView card={CARD_FIXTURES.importProgress.indexing!} />, {
      indexing: { pause, resume: vi.fn(async () => ok(null)), retryFailed: vi.fn(async () => ok(null)) },
    });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Pause' })));
    expect(pause).toHaveBeenCalledOnce();
  });
});
