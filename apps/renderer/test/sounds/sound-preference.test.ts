// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, NotFoundError, SETTINGS_COMMANDS, type InterfaceSoundsState } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import { createSoundPreference, SOUNDS_STORAGE_KEY } from '../../src/features/sounds/sound-preference';

type PreferenceBackend = Parameters<typeof createSoundPreference>[0];
type DispatchInput = Parameters<PreferenceBackend['commands']['dispatch']>[0];

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness(initial: InterfaceSoundsState = { enabled: true, initialized: false }, legacy?: 'off') {
  let stored = initial;
  const values = new Map<string, string>(legacy ? [[SOUNDS_STORAGE_KEY, legacy]] : []);
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    removeItem: vi.fn((key: string) => void values.delete(key)),
  };
  const load = vi.fn(async () => ({ ...stored }));
  const execute = async (input: DispatchInput) => {
    if (input.name === SETTINGS_COMMANDS.setInterfaceSounds || !stored.initialized)
      stored = { enabled: (input.payload as { enabled: boolean }).enabled, initialized: true };
    return {
      id: newId<'Command'>(),
      name: input.name,
      projectId: null,
      sequence: 1,
      result: { ...stored },
      undoable: input.name === SETTINGS_COMMANDS.setInterfaceSounds,
      deduplicated: false,
    };
  };
  const dispatch = vi.fn(execute);
  const unused = async (): Promise<never> => {
    throw new Error('Unexpected command operation in sound preference');
  };
  const backend = {
    interfaceSounds: { state: load },
    commands: {
      dispatch,
      undo: unused,
      redo: unused,
      history: unused,
      list: unused,
      editing: unused,
      watchEditing: unused,
    },
  };
  const preference = createSoundPreference(backend, () => storage);
  return {
    preference,
    load,
    dispatch,
    execute,
    storage,
    values,
    store: (state: InterfaceSoundsState) => void (stored = state),
  };
}

describe('interface sound preference initialization', () => {
  it('remains unavailable while loading and enables new installs only after initialization', async () => {
    const h = harness();
    const first = deferred<InterfaceSoundsState>();
    h.load.mockReturnValueOnce(first.promise);
    const loading = h.preference.refresh();
    expect(h.preference.getSnapshot()).toEqual({ enabled: true, ready: false, pending: false, error: null });
    expect(h.dispatch).not.toHaveBeenCalled();
    first.resolve({ enabled: true, initialized: false });
    await loading;
    expect(h.dispatch).toHaveBeenCalledWith({
      name: SETTINGS_COMMANDS.initializeInterfaceSounds,
      payload: { enabled: true },
      source: 'ui',
    });
    expect(h.preference.getSnapshot()).toEqual({ enabled: true, ready: true, pending: false, error: null });
  });

  it('migrates legacy off and removes the legacy key only after it is saved', async () => {
    const h = harness(undefined, 'off');
    const saved = deferred<void>();
    h.dispatch.mockImplementationOnce(async (input) => {
      await saved.promise;
      return h.execute(input);
    });
    const loading = h.preference.refresh();
    await vi.waitFor(() => expect(h.dispatch).toHaveBeenCalled());
    expect(h.values.get(SOUNDS_STORAGE_KEY)).toBe('off');
    expect(h.preference.getSnapshot().ready).toBe(false);
    saved.resolve();
    await loading;
    expect(h.dispatch.mock.calls[0]?.[0].payload).toEqual({ enabled: false });
    expect(h.preference.getSnapshot()).toMatchObject({ enabled: false, ready: true });
    expect(h.values.has(SOUNDS_STORAGE_KEY)).toBe(false);
  });

  it('uses an initialized preference over legacy off even when legacy storage is blocked', async () => {
    const h = harness({ enabled: true, initialized: true }, 'off');
    h.storage.getItem.mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    h.storage.removeItem.mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    await h.preference.refresh();
    expect(h.storage.getItem).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.preference.getSnapshot()).toMatchObject({ enabled: true, ready: true, error: null });
  });

  it('stays muted with blocked legacy storage until an explicit choice establishes the preference', async () => {
    const h = harness();
    h.storage.getItem.mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    await h.preference.refresh();
    expect(h.preference.getSnapshot()).toMatchObject({ ready: false, pending: false });
    expect(h.preference.getSnapshot().error).not.toBeNull();
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(await h.preference.setEnabled(false)).toBe(true);
    expect(h.preference.getSnapshot()).toEqual({ enabled: false, ready: true, pending: false, error: null });
  });

  it('retains legacy off and stays muted after a failed migration, then retries successfully', async () => {
    const h = harness(undefined, 'off');
    h.dispatch.mockRejectedValueOnce(NotFoundError({ entity: 'settings' }));
    await h.preference.refresh();
    expect(h.preference.getSnapshot()).toMatchObject({ ready: false, error: { code: 'core.not_found' } });
    expect(h.values.get(SOUNDS_STORAGE_KEY)).toBe('off');
    await h.preference.refresh();
    expect(h.preference.getSnapshot()).toMatchObject({ enabled: false, ready: true, error: null });
  });

  it('never treats a failed state read as an enabled default', async () => {
    const h = harness();
    h.load.mockRejectedValueOnce(NotFoundError({ entity: 'settings' }));
    await h.preference.refresh();
    expect(h.preference.getSnapshot()).toMatchObject({ ready: false, error: { code: 'core.not_found' } });
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.storage.removeItem).not.toHaveBeenCalled();
  });
});

describe('sound preference changes and races', () => {
  it('mutes during an external change refresh and applies the new preference', async () => {
    const h = harness({ enabled: true, initialized: true });
    await h.preference.refresh();
    const next = deferred<InterfaceSoundsState>();
    h.load.mockReturnValueOnce(next.promise);
    h.preference.changed();
    expect(h.preference.getSnapshot().ready).toBe(false);
    next.resolve({ enabled: false, initialized: true });
    await vi.waitFor(() => expect(h.preference.getSnapshot()).toMatchObject({ ready: true, enabled: false }));
  });

  it('keeps a newer explicit choice when an older initial read arrives', async () => {
    const h = harness({ enabled: true, initialized: true });
    const old = deferred<InterfaceSoundsState>();
    h.load.mockReturnValueOnce(old.promise);
    const loading = h.preference.refresh();
    expect(await h.preference.setEnabled(false)).toBe(true);
    old.resolve({ enabled: true, initialized: true });
    await loading;
    expect(h.preference.getSnapshot()).toMatchObject({ enabled: false, ready: true });
  });

  it('does not let in-flight legacy initialization replace a newer user choice', async () => {
    const h = harness(undefined, 'off');
    const initialize = deferred<void>();
    h.dispatch.mockImplementationOnce(async (input) => {
      await initialize.promise;
      return h.execute(input);
    });
    const loading = h.preference.refresh();
    await vi.waitFor(() => expect(h.dispatch).toHaveBeenCalled());
    expect(await h.preference.setEnabled(true)).toBe(true);
    initialize.resolve();
    await loading;
    expect(h.preference.getSnapshot()).toMatchObject({ enabled: true, ready: true });
  });

  it('reflects off immediately and ignores an older write acknowledgement after a newer choice', async () => {
    const h = harness({ enabled: true, initialized: true });
    await h.preference.refresh();
    const acknowledge = deferred<void>();
    h.dispatch.mockImplementationOnce(async (input) => {
      const result = await h.execute(input);
      await acknowledge.promise;
      return result;
    });
    const old = h.preference.setEnabled(false);
    expect(h.preference.getSnapshot()).toMatchObject({ enabled: false, ready: false, pending: true });
    expect(await h.preference.setEnabled(true)).toBe(true);
    acknowledge.resolve();
    expect(await old).toBe(false);
    expect(h.preference.getSnapshot()).toMatchObject({ enabled: true, ready: true, pending: false });
  });

  it('rereads changes received while a write is reading its saved value', async () => {
    const h = harness({ enabled: false, initialized: true });
    await h.preference.refresh();
    const old = deferred<InterfaceSoundsState>();
    h.load.mockReturnValueOnce(old.promise);
    const writing = h.preference.setEnabled(true);
    await vi.waitFor(() => expect(h.load).toHaveBeenCalledTimes(2));
    h.store({ enabled: false, initialized: true });
    h.preference.changed();
    old.resolve({ enabled: true, initialized: true });
    expect(await writing).toBe(false);
    expect(h.preference.getSnapshot()).toMatchObject({ enabled: false, ready: true });
  });

  it('remains muted on a failed choice and retries without reporting a successful enable', async () => {
    const h = harness({ enabled: false, initialized: true });
    await h.preference.refresh();
    h.dispatch.mockRejectedValueOnce(NotFoundError({ entity: 'settings' }));
    expect(await h.preference.setEnabled(true)).toBe(false);
    expect(h.preference.getSnapshot()).toMatchObject({
      ready: false,
      pending: false,
      error: { code: 'core.not_found' },
    });
    expect(await h.preference.setEnabled(true)).toBe(true);
    expect(h.preference.getSnapshot()).toMatchObject({ enabled: true, ready: true, error: null });
  });

  it('can refresh after cancellation while the previous write acknowledgement is pending', async () => {
    const h = harness({ enabled: true, initialized: true });
    await h.preference.refresh();
    const acknowledge = deferred<void>();
    h.dispatch.mockImplementationOnce(async (input) => {
      const result = await h.execute(input);
      await acknowledge.promise;
      return result;
    });
    const writing = h.preference.setEnabled(false);
    h.preference.cancel();
    const resumed = h.preference.refresh();
    acknowledge.resolve();
    expect(await writing).toBe(false);
    await resumed;
    await vi.waitFor(() => expect(h.preference.getSnapshot()).toMatchObject({ enabled: false, ready: true }));
  });

  it('does not resume a cancelled preference unless a new refresh is requested', async () => {
    const h = harness({ enabled: false, initialized: true });
    await h.preference.refresh();
    const acknowledge = deferred<void>();
    h.dispatch.mockImplementationOnce(async (input) => {
      const result = await h.execute(input);
      await acknowledge.promise;
      return result;
    });
    const writing = h.preference.setEnabled(true);
    h.preference.cancel();
    acknowledge.resolve();
    expect(await writing).toBe(false);
    expect(h.preference.getSnapshot().ready).toBe(false);
    expect(h.load).toHaveBeenCalledTimes(1);
  });

  it('does not report a successful enable if reading the saved value fails', async () => {
    const h = harness({ enabled: false, initialized: true });
    await h.preference.refresh();
    h.load.mockRejectedValueOnce(NotFoundError({ entity: 'settings' }));
    expect(await h.preference.setEnabled(true)).toBe(false);
    expect(h.preference.getSnapshot()).toMatchObject({ ready: false, error: { code: 'core.not_found' } });
    await h.preference.refresh();
    expect(h.preference.getSnapshot()).toMatchObject({ enabled: true, ready: true, error: null });
  });
});
