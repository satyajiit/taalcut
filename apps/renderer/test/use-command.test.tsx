// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
// UX1 W2-1 (X6): a command that fails says so. useCommand's failures show a toast that names the cause with
// the error's fix (or Try again) as its button, unless the caller shows the error itself.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import {
  CancelledError,
  defineError,
  NotFoundError,
  TimeoutError,
  toRpcError,
  UnknownError,
} from '@taalcut/core';
import { errorMessage, toastStore } from '@taalcut/ui';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BackendProvider } from '../src/backend/backend';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { useCommand } from '../src/backend/use-command';
import { activateLocale } from '../src/i18n/i18n';
import { failureToastOptions } from '../src/shell-states/failure-toast';
import { watched } from './settings/spied-backend';

beforeAll(async () => {
  await activateLocale('en');
});

afterEach(() => {
  for (const entry of toastStore.list()) toastStore.remove(entry.id);
});

function wrapper({ children }: { children: ReactNode }) {
  const fake = createFakeBackend({ today: () => '2026-10-12' });
  return (
    <I18nProvider i18n={i18n}>
      <BackendProvider backend={fake.client}>{children}</BackendProvider>
    </I18nProvider>
  );
}

describe('useCommand', () => {
  it('shows a failure as a toast and still returns the Result', async () => {
    const { result } = renderHook(() => useCommand(), { wrapper });
    let outcome: Awaited<ReturnType<typeof result.current.run>> | undefined;
    await act(async () => {
      outcome = await result.current.run({ name: 'no.such_command', payload: {} });
    });
    expect(outcome?.ok).toBe(false);
    const shown = toastStore.list();
    expect(shown).toHaveLength(1);
    // The error's own sentence, which names the cause.
    if (outcome && !outcome.ok)
      expect(shown[0]).toMatchObject({ tone: 'danger', title: errorMessage(i18n, outcome.error) });
  });

  it('stays quiet when the caller shows the error itself', async () => {
    const { result } = renderHook(() => useCommand({ toast: false }), { wrapper });
    await act(async () => {
      await result.current.run({ name: 'no.such_command', payload: {} });
    });
    expect(toastStore.list()).toHaveLength(0);
  });
});

describe('the failure toast’s fix', () => {
  /** A failure whose fix is a UI command that takes no payload (jobs' disk-space error opens Storage). */
  const SpaceLow = defineError<{ readonly requiredBytes: number }>('jobs.disk_space_low', {
    fix: { command: 'system.openStorage', labelKey: 'fix.openStorageSettings' },
  });

  it('runs a fix that names no payload with an empty one, which the bus takes', async () => {
    const fake = createFakeBackend({ today: () => '2026-10-12' });
    const calls = new Map<string, unknown[]>();
    // Each dispatch's outcome, by command name: the failing command answers with SpaceLow, the rest go to the fake.
    const outcomes: { name: unknown; ok: Promise<boolean> }[] = [];
    const backend = watched(
      fake.client,
      [
        {
          namespace: 'commands',
          procedure: 'dispatch',
          answer: (input, answer) => {
            const name =
              typeof input === 'object' && input !== null && 'name' in input ? input.name : undefined;
            const reply =
              name === 'library.reindex'
                ? Promise.reject(toRpcError(SpaceLow({ requiredBytes: 1 })))
                : Promise.resolve(answer());
            outcomes.push({
              name,
              ok: reply.then(
                () => true,
                () => false,
              ),
            });
            return reply;
          },
        },
      ],
      calls,
    );
    const { result } = renderHook(() => useCommand(), {
      wrapper: ({ children }) => (
        <I18nProvider i18n={i18n}>
          <BackendProvider backend={backend}>{children}</BackendProvider>
        </I18nProvider>
      ),
    });
    await act(async () => {
      await result.current.run({ name: 'library.reindex', payload: {} });
    });
    const [shown] = toastStore.list();
    expect(shown?.action?.label).toBe('Open Storage Settings');
    act(() => shown?.action?.onSelect());
    await waitFor(() => expect(outcomes.map((o) => o.name)).toContain('system.openStorage'));
    const fix = outcomes.find((o) => o.name === 'system.openStorage');
    expect(calls.get('commands.dispatch')?.at(-1)).toMatchObject({ name: 'system.openStorage', payload: {} });
    // It used to go out with `payload: undefined`, which the bus refuses as core.validation.
    expect(await fix?.ok).toBe(true);
    expect(toastStore.list()).toHaveLength(1);
  });
});

describe('failureToastOptions', () => {
  const actions = () => ({ fix: vi.fn(), retry: vi.fn() });

  it('offers the error’s fix as the button, and runs it', () => {
    const run = actions();
    const error = NotFoundError(
      { entity: 'source' },
      {
        fix: { command: 'library.chooseFolder', labelKey: 'fix.chooseFolder', payload: { reason: 'moved' } },
      },
    );
    const options = failureToastOptions(i18n, error, run);
    expect(options).toMatchObject({
      tone: 'danger',
      title: 'That folder is no longer here. It may have been moved or deleted.',
    });
    expect(options?.action?.label).toBe('Choose another folder');
    options?.action?.onSelect();
    expect(run.fix).toHaveBeenCalledWith(error.fix);
    expect(run.retry).not.toHaveBeenCalled();
  });

  it('offers Try again when trying again can help', () => {
    const run = actions();
    const options = failureToastOptions(i18n, TimeoutError({ ms: 30_000 }), run);
    expect(options?.action?.label).toBe('Try again');
    options?.action?.onSelect();
    expect(run.retry).toHaveBeenCalledOnce();
  });

  it('has no button when nothing can fix it from here', () => {
    expect(failureToastOptions(i18n, UnknownError(), actions())?.action).toBeUndefined();
  });

  it('says nothing about a command stopped on purpose', () => {
    expect(failureToastOptions(i18n, CancelledError(), actions())).toBeUndefined();
  });
});
