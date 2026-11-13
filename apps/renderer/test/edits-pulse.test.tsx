// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, TimeoutError, toRpcError } from '@taalcut/core';
import { createThemeEngine, localStorageStore } from '@taalcut/ui';
import { createMemoryHistory } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/app';
import type { Backend } from '../src/backend/backend';
import { themeTarget } from '../src/backend/fake/expose';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { activateLocale } from '../src/i18n/i18n';
import { createAppRouter } from '../src/router';
import { createTestServices } from '../src/services/create';

function override<T extends object>(target: T, patch: Partial<T>): T {
  return new Proxy(target, {
    get: (object, key, receiver) =>
      Object.prototype.hasOwnProperty.call(patch, key)
        ? patch[key as keyof T]
        : Reflect.get(object, key, receiver),
  });
}

type Dispatch = Backend['commands']['dispatch'];
type Request = Parameters<Dispatch>[0];

async function open(
  connected: boolean,
  intercept?: (input: Request) => Promise<unknown> | undefined,
  setup?: Partial<Backend['pluginsSetup']>,
) {
  await activateLocale('en');
  const engine = createThemeEngine({ store: localStorageStore() });
  await engine.init();
  const fake = createFakeBackend({ theme: themeTarget(engine), plugins: { editsConnected: connected } });
  const requests: Request[] = [];
  const commands: Request[] = [];
  const backend = override(fake.client, {
    pluginsSetup: override(fake.client.pluginsSetup, setup ?? {}),
    commands: override(fake.client.commands, {
      dispatch: (input, options) => {
        commands.push(input);
        if (input.name === 'plugins.call') requests.push(input);
        const intercepted = intercept?.(input);
        return intercepted
          ? intercepted.then((result) => ({
              id: newId<'Command'>(),
              name: input.name,
              projectId: null,
              sequence: null,
              result,
              undoable: false,
              deduplicated: false,
            }))
          : fake.client.commands.dispatch(input, options);
      },
    }),
  });
  const router = createAppRouter(createMemoryHistory({ initialEntries: ['/insights'] }));
  await act(async () => {
    render(<App engine={engine} router={router} backend={backend} services={createTestServices()} />);
    await router.load();
  });
  return { requests, commands };
}

const payload = (request: Request) =>
  request.payload as { mode: string; toolName: string; input: Record<string, unknown> };
const trackList = () => screen.findByRole('list', { name: 'Instagram Edits audio tracks' });

describe('Instagram Edits feed boundaries', () => {
  it('shows connection state without invented tracks or saved IDs', async () => {
    const { requests } = await open(false);
    expect(
      await screen.findByText('Connect Instagram Edits to browse tracks from your account.'),
    ).toBeTruthy();
    expect(screen.queryByText('Bender (Reels Sound - Reveal)')).toBeNull();
    expect(screen.queryAllByRole('link', { name: 'Draft brief' })).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  it('fetches once across rerenders and sends the registered command mode and license', async () => {
    const { requests } = await open(true);
    await trackList();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(requests).toHaveLength(1);
    expect(payload(requests[0]!)).toMatchObject({ mode: 'external', toolName: 'api.listMusicTracks' });
    const filters = screen.getByRole('radiogroup', { name: 'Music license' });
    fireEvent.click(within(filters).getByRole('radio', { name: 'Royalty-free' }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(payload(requests[1]!).input.license).toBe('royaltyFree');
  });

  it('keeps an empty live response empty', async () => {
    await open(true, (input) =>
      input.name === 'plugins.call' ? Promise.resolve({ tracks: [] }) : undefined,
    );
    expect(
      await screen.findByText('No tracks match this filter. Try another category or clear your search.'),
    ).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Instagram Edits audio tracks' })).toBeNull();
    expect(screen.queryByText('Bender (Reels Sound - Reveal)')).toBeNull();
  });

  it('shows a failed read instead of offering demo audio', async () => {
    await open(true, (input) =>
      input.name === 'plugins.call' ? Promise.reject(toRpcError(TimeoutError({ ms: 10_000 }))) : undefined,
    );
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Bender (Reels Sound - Reveal)')).toBeNull();
  });

  it('discards an older filter response and never marks a failed bookmark as saved', async () => {
    let release: (value: unknown) => void = () => {};
    const held = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    let first = true;
    const { requests } = await open(true, (input) => {
      if (input.name !== 'plugins.call') return undefined;
      if (first) {
        first = false;
        return held;
      }
      if (payload(input).toolName === 'api.favoriteMusicTrack')
        return Promise.reject(toRpcError(TimeoutError({ ms: 10_000 })));
      return Promise.resolve({
        tracks: [
          { id: 'live-track', title: 'Current live track', audioAssetId: 'live-track', durationSeconds: 12 },
        ],
      });
    });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tracks or artists' }), {
      target: { value: 'Current' },
    });
    const list = await trackList();
    expect(within(list).getByText('Current live track')).toBeTruthy();
    await act(async () => {
      release({ tracks: [{ id: 'old-track', title: 'Old live track' }] });
    });
    expect(screen.queryByText('Old live track')).toBeNull();
    fireEvent.click(within(list).getByRole('button', { name: 'Save audio' }));
    await screen.findByRole('alert');
    expect(within(list).getByRole('button', { name: 'Save audio' }).hasAttribute('disabled')).toBe(false);
    expect(requests.filter((request) => payload(request).toolName === 'api.favoriteMusicTrack')).toHaveLength(
      1,
    );
  });
  it('shows unknown facts and unavailable remote preview without inventing rights or duration', async () => {
    const { requests } = await open(true, (input) =>
      input.name === 'plugins.call'
        ? Promise.resolve({
            tracks: [
              {
                id: 'metadata-only',
                title: 'Real provider title',
                previewUrl: 'https://music.example/song.mp3',
              },
            ],
          })
        : undefined,
    );
    const list = await trackList();
    expect(within(list).getByText('Licence not supplied')).toBeTruthy();
    expect(within(list).getByText('Preview unavailable')).toBeTruthy();
    expect(within(list).queryByText('0 s')).toBeNull();
    expect(within(list).queryByText(/Reels ready|All platforms/)).toBeNull();
    const cover = within(list).getByRole('button', { name: 'Preview unavailable for Real provider title' });
    expect(cover.hasAttribute('disabled')).toBe(true);
    fireEvent.click(cover);
    expect(requests).toHaveLength(1);
  });

  it('saves the supplied audio ID after success and uses the registered Saved tool', async () => {
    const { requests } = await open(true, (input) =>
      input.name === 'plugins.call'
        ? Promise.resolve({
            tracks: [{ id: 'row-id', audioAssetId: 'supplied-audio-id', title: 'Provider song' }],
          })
        : undefined,
    );
    const list = await trackList();
    fireEvent.click(within(list).getByRole('button', { name: 'Save audio' }));
    const saved = await within(list).findByRole('button', { name: 'Saved' });
    expect(saved.hasAttribute('disabled')).toBe(true);
    expect(payload(requests[1]!)).toEqual({
      pluginId: 'instagram-edits',
      mode: 'external',
      toolName: 'api.favoriteMusicTrack',
      input: { track: 'supplied-audio-id' },
    });
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Audio category' })).getByRole('radio', {
        name: 'Saved',
      }),
    );
    await waitFor(() => expect(payload(requests.at(-1)!).toolName).toBe('api.getSavedTracks'));
    expect(payload(requests.at(-1)!).input).toEqual({});
  });

  it('keeps an unsuccessful token import from enabling the plugin', async () => {
    const { commands } = await open(false, undefined, {
      importCredential: () => Promise.reject(toRpcError(TimeoutError({ ms: 10_000 }))),
    });
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Insights source' })).getByRole('radio', {
        name: 'Postiz channels',
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Import token from clipboard' }));
    await screen.findByRole('alert');
    expect(commands.some((request) => request.name === 'plugins.setEnabled')).toBe(false);
  });

  it('shows a connection test failure while the previous plugin status is active', async () => {
    await open(true, undefined, {
      testConnection: () => Promise.reject(toRpcError(TimeoutError({ ms: 10_000 }))),
    });
    await trackList();
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
