// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main holds the lan process while a window iterates `transfer.devices`
 * (desktop SPEC, USB wiring). The hold comes from wrapping the lan client:
 * these tests drive that wrapper with a fake client.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createDesktopLanLifecycle,
  trackDevicesWatch,
  watchLanDevices,
} from '../src/main/transfer/lan-bridge';

async function* views(count: number, failAt?: number): AsyncGenerator<{ readonly n: number }> {
  for (let n = 0; n < count; n += 1) {
    if (n === failAt) throw new Error('lan process restarted');
    yield { n };
  }
}

function fakeClient(count = 3, failAt?: number) {
  const session = vi.fn(async () => ({ state: 'stopped' }));
  return {
    session,
    client: {
      transfer: {
        devices: vi.fn(async () => views(count, failAt)),
        session,
      },
      library: { list: vi.fn(async () => []) },
    },
  };
}

describe('watchLanDevices', () => {
  it('notes open on the first next and closed once when the stream ends', async () => {
    const note = vi.fn();
    const { client } = fakeClient(3);
    const stream = await watchLanDevices(client, note).transfer.devices();
    expect(note).not.toHaveBeenCalled();
    const seen: number[] = [];
    for await (const view of stream) seen.push(view.n);
    expect(seen).toEqual([0, 1, 2]);
    expect(note.mock.calls).toEqual([[true], [false]]);
  });

  it('notes closed when the window stops iterating early', async () => {
    const note = vi.fn();
    const { client } = fakeClient(10);
    const stream = await watchLanDevices(client, note).transfer.devices();
    for await (const view of stream) {
      if (view.n === 1) break;
    }
    expect(note.mock.calls).toEqual([[true], [false]]);
  });

  it('notes closed when the stream fails', async () => {
    const note = vi.fn();
    const { client } = fakeClient(5, 2);
    const stream = await watchLanDevices(client, note).transfer.devices();
    await expect(
      (async () => {
        for await (const view of stream) void view;
      })(),
    ).rejects.toThrow('lan process restarted');
    expect(note.mock.calls).toEqual([[true], [false]]);
  });

  it('never notes a stream nobody iterated', async () => {
    const note = vi.fn();
    const { client } = fakeClient(3);
    await watchLanDevices(client, note).transfer.devices();
    expect(note).not.toHaveBeenCalled();
  });

  it('leaves every other procedure and namespace as it was', async () => {
    const note = vi.fn();
    const { client, session } = fakeClient(3);
    const wrapped = watchLanDevices(client, note);
    expect(wrapped.transfer.session).toBe(session);
    expect(wrapped.library).toBe(client.library);
    await wrapped.transfer.session();
    expect(note).not.toHaveBeenCalled();
  });
});

describe('trackDevicesWatch', () => {
  it('holds the process across independently grouped window and import-discovery streams', async () => {
    vi.useFakeTimers();
    const stop = vi.fn(async () => undefined);
    const lifecycle = createDesktopLanLifecycle({ start: vi.fn(), stop }, { now: Date.now });
    const windows = trackDevicesWatch(lifecycle.onDevicesWatch);
    const imports = trackDevicesWatch(lifecycle.onDevicesWatch);
    const first = await watchLanDevices(fakeClient(10).client, windows).transfer.devices();
    const second = await watchLanDevices(fakeClient(10).client, imports).transfer.devices();
    try {
      await first.next();
      await second.next();
      await second.return(undefined);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(stop).not.toHaveBeenCalled();
      await first.return(undefined);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(stop).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      await first.return(undefined);
      await second.return(undefined);
      lifecycle.dispose();
      vi.useRealTimers();
    }
  });

  it('holds while any of two windows iterates and lets go after the last', async () => {
    const onWatch = vi.fn();
    const note = trackDevicesWatch(onWatch);
    const first = await watchLanDevices(fakeClient(10).client, note).transfer.devices();
    const second = await watchLanDevices(fakeClient(10).client, note).transfer.devices();
    await first.next();
    await second.next();
    expect(onWatch.mock.calls).toEqual([[true]]);
    await first.return(undefined);
    expect(onWatch.mock.calls).toEqual([[true]]);
    await second.return(undefined);
    expect(onWatch.mock.calls).toEqual([[true], [false]]);
  });

  it('ignores a close it never saw open', () => {
    const onWatch = vi.fn();
    const note = trackDevicesWatch(onWatch);
    note(false);
    note(true);
    note(false);
    note(false);
    expect(onWatch.mock.calls).toEqual([[true], [false]]);
  });
});
