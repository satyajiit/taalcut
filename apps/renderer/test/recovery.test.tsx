// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { isId } from '@taalcut/core';
import { createThemeEngine, localStorageStore } from '@taalcut/ui';
import { createMemoryHistory } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/app';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { activateLocale } from '../src/i18n/i18n';
import {
  createFakeRecoveryClient,
  FAKE_UNFINISHED_RUN,
  type RecoveryScenario,
} from '../src/recovery/fake-recovery';
import { createAppRouter } from '../src/router';
import { createTestServices } from '../src/services/create';
import { routeId } from '../src/shell/route-id';

async function launch(
  scenario: RecoveryScenario,
  initialEntry = '/library',
  overrideChat?: Partial<ReturnType<typeof createTestServices>['chat']>,
) {
  await activateLocale('en');
  const engine = createThemeEngine({ store: localStorageStore() });
  await engine.init();
  const recovery = createFakeRecoveryClient(scenario);
  const baseServices = createTestServices();
  const services = {
    ...baseServices,
    chat: overrideChat ? { ...baseServices.chat, ...overrideChat } : baseServices.chat,
    recovery,
  };
  const fake = createFakeBackend();
  const router = createAppRouter(createMemoryHistory({ initialEntries: [initialEntry] }));
  await act(async () => {
    render(<App engine={engine} router={router} backend={fake.client} services={services} />);
    await router.load();
  });
  return { router, recovery, baseChat: baseServices.chat, controls: fake.controls };
}

describe('recovery prompt', () => {
  it('stays away when there is nothing to recover', async () => {
    await launch('none');
    await act(async () => undefined);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says a backup was restored, shows the details, and goes when dismissed', async () => {
    const { recovery } = await launch('restored');
    const dialog = await screen.findByRole('dialog', { name: 'Taalcut is back' });
    expect(dialog.textContent).toContain('Your library file was damaged');
    // The copy's date has its month in words, not "10/11/26" (audit L10), in a <time>: data, never translated.
    const copied = dialog.querySelector('time');
    expect(copied?.getAttribute('dateTime')).toBe('2026-10-11T14:00:00.000Z');
    expect(copied?.textContent).toMatch(/^Oct 1[12], 2026, \d{1,2}:\d{2}\s?[AP]M$/);
    expect(screen.queryByRole('button', { name: /Resume/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    expect(dialog.textContent).toContain('library.db.1760169600000.v5.daily.bak');
    expect(dialog.textContent).toContain('timeline.setMusic');

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const after = await recovery.report();
    expect(after.ok && after.value.needsAttention).toBe(false);
  });

  it('says when the library file was missing, with no damaged file to point to', async () => {
    await launch('missing');
    const dialog = await screen.findByRole('dialog', { name: 'Taalcut is back' });
    expect(dialog.textContent).toContain(
      "Taalcut couldn't find your library file, so it put back the copy from",
    );
    expect(dialog.textContent).not.toContain('damaged');
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    expect(dialog.textContent).toContain('library.db.1760169600000.v5.daily.bak');
    expect(dialog.textContent).not.toContain('The damaged file was kept here');
  });

  it('resumes an unfinished run and opens its conversation', async () => {
    const { router, recovery } = await launch('unfinished');
    const dialog = await screen.findByRole('dialog', { name: 'Taalcut is back' });
    expect(dialog.textContent).toContain('One agent task stopped partway.');
    expect(dialog.textContent).toContain('One background job will continue on its own.');
    expect(dialog.textContent).toContain("One background job couldn't restart.");

    fireEvent.click(screen.getByRole('button', { name: 'Resume the task' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(recovery.resumed()).toEqual([FAKE_UNFINISHED_RUN]);
    await waitFor(() => expect(router.state.location.pathname).toBe('/chat/01K7C5M6Q8R9S0T1V2W3X4Y5Z6'));
  });

  it('reloads an already-open conversation and follows the resumed run when Resume the task is clicked', async () => {
    const base = createTestServices().chat;
    let calls = 0;
    const { recovery } = await launch('unfinished', '/chat/01K7C5M6Q8R9S0T1V2W3X4Y5Z6', {
      async getConversation(id) {
        calls += 1;
        const res = await base.getConversation(id);
        if (!res.ok || calls < 2) return res;
        return {
          ok: true,
          value: {
            ...res.value,
            history: [
              ...res.value.history,
              {
                type: 'agent.runStarted',
                at: Date.now(),
                payload: {
                  runId: FAKE_UNFINISHED_RUN,
                  conversationId: id,
                },
              },
            ],
          },
        };
      },
      async *follow(runId) {
        yield {
          type: 'agent.messageDelta',
          at: Date.now(),
          payload: {
            runId,
            messageId: '01K7C5M6Q8R9S0T1V2W3X4M999' as never,
            delta: 'Picked up after restart.',
          },
        };
        yield {
          type: 'agent.runFinished',
          at: Date.now(),
          payload: {
            runId,
            status: 'succeeded',
          },
        };
      },
    });

    await screen.findByRole('dialog', { name: 'Taalcut is back' });
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(1));
    fireEvent.click(screen.getByRole('button', { name: 'Resume the task' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(recovery.resumed()).toEqual([FAKE_UNFINISHED_RUN]);
    await screen.findByText('Picked up after restart.');
  });
});

describe('route ids', () => {
  it('accepts exactly the ids core accepts', () => {
    const samples = [
      '01K7C5M6Q8R9S0T1V2W3X4Y5Z6',
      '01k7c5m6q8r9s0t1v2w3x4y5z6',
      '01K7C5M6Q8R9S0T1V2W3X4Y5ZI',
      'short',
      '',
    ];
    for (const value of samples) {
      let accepted = true;
      try {
        routeId(value);
      } catch {
        accepted = false;
      }
      expect(accepted, value).toBe(isId(value));
    }
  });
});
