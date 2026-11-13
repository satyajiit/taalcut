// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { PLUGIN_COMMANDS, toRpcError, ValidationError } from '@taalcut/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../render-app';
import { renderWatched, type Watch } from './spied-backend';

const IMPORT: Watch = { namespace: 'pluginsSetup', procedure: 'importCredential' };

describe('Settings › Plugins', () => {
  it.each(['missing-plugin', 'NOT-AN-ID'])('shows the not-found page for %s', async (pluginId) => {
    await renderApp(`/settings/plugins/${pluginId}`);
    expect(await screen.findByRole('heading', { level: 1, name: "This page doesn't exist" })).toBeTruthy();
  });

  it('routes from the registry to a dedicated, branded Postiz page with its four views', async () => {
    const { router } = await renderApp('/settings/plugins');
    const row = await screen.findByRole('link', { name: /Postiz.*Publish, schedule/ });
    expect(row.querySelector('img')?.getAttribute('src')).toBe('/plugins/postiz.svg');
    await act(async () => {
      fireEvent.click(row);
    });
    // The plugin opens on its Connection view.
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/plugins/postiz/connection'));
    await screen.findByRole('region', { name: 'Connection' });
    expect(await screen.findByRole('heading', { name: /Postiz/, level: 1 })).toBeTruthy();
    const views = screen.getByRole('navigation', { name: 'Plugin' });
    expect(within(views).getByRole('link', { name: 'Connection' }).getAttribute('aria-current')).toBe('page');
    for (const [view, region] of [
      ['Access', 'Access for the AI'],
      ['Skills', 'Skills'],
      ['Tools', 'Tools'],
    ] as const) {
      await act(async () => {
        fireEvent.click(within(views).getByRole('link', { name: view }));
      });
      expect(await screen.findByRole('region', { name: region })).toBeTruthy();
      expect(within(views).getByRole('link', { name: view }).getAttribute('aria-current')).toBe('page');
    }
    expect(router.state.location.pathname).toBe('/settings/plugins/postiz/tools');
    expect(screen.getByRole('region', { name: 'Features' })).toBeTruthy();
  });

  it('imports credentials without sending their contents through the renderer or command log', async () => {
    const { callsTo, controls } = await renderWatched('/settings/plugins/postiz', IMPORT, {
      interfaceSounds: { saved: { enabled: true, initialized: true } },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Import from clipboard' }));
    expect(await screen.findByText('Credential saved')).toBeTruthy();
    expect(callsTo(IMPORT)).toEqual([{ pluginId: 'postiz', credentialId: 'api-key' }]);
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(controls.dispatched).toEqual([]);
    expect(controls.plugins.get().configuredCredentials).toEqual(['api-key']);
  });

  it('saves a self-hosted Tailscale endpoint through the command bus before importing', async () => {
    const dispatch: Watch = { namespace: 'commands', procedure: 'dispatch' };
    const { callsTo } = await renderWatched('/settings/plugins/postiz', dispatch, {
      interfaceSounds: { saved: { enabled: true, initialized: true } },
    });
    const url = await screen.findByLabelText('API base URL');
    fireEvent.change(url, { target: { value: 'https://postiz.example.ts.net/api/public/v1' } });
    expect(screen.getByRole('button', { name: 'Import from clipboard' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Save connection address' }));
    await waitFor(() =>
      expect(callsTo(dispatch)).toEqual([
        {
          name: PLUGIN_COMMANDS.configure,
          payload: {
            pluginId: 'postiz',
            config: { 'api-url': 'https://postiz.example.ts.net/api/public/v1', 'mcp-url': '' },
          },
          source: 'ui',
        },
      ]),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Import from clipboard' })).toHaveProperty('disabled', false),
    );
  });

  it('grants access, activates, and disconnects through person commands', async () => {
    const { controls } = await renderApp('/settings/plugins/postiz/access', {
      plugins: { connected: true, enabled: false, access: [] },
      interfaceSounds: { saved: { enabled: true, initialized: true } },
    });
    fireEvent.click(await screen.findByRole('checkbox', { name: /Manage and publish posts/ }));
    await waitFor(() => expect(controls.plugins.get().grantedAccess).toEqual(['posts-write']));
    fireEvent.click(screen.getByRole('switch', { name: 'Let the AI use this plugin' }));
    expect(await screen.findByText('Active')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect plugin' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect plugin' }));
    expect(await screen.findByText('Not connected')).toBeTruthy();
    expect(controls.plugins.get().configuredCredentials).toEqual([]);
    expect(controls.dispatched.map(({ name, source }) => [name, source])).toEqual([
      [PLUGIN_COMMANDS.setAccess, 'ui'],
      [PLUGIN_COMMANDS.setEnabled, 'ui'],
      [PLUGIN_COMMANDS.disconnect, 'ui'],
    ]);
  });

  it('shows requests made by the AI while the registry is open', async () => {
    const { controls } = await renderApp('/settings/plugins');
    await screen.findByRole('link', { name: /Postiz/ });
    await act(async () => {
      await controls.bus.dispatch(
        PLUGIN_COMMANDS.requestSetup,
        { pluginId: 'postiz' },
        { source: 'agent', actor: 'agent:test' },
      );
    });
    expect(await screen.findByText('Setup requested')).toBeTruthy();
  });

  it('shows a failed import and lets the person retry', async () => {
    const rejected: Watch = {
      ...IMPORT,
      answer: () => Promise.reject(toRpcError(ValidationError({ field: 'credential' }))),
    };
    await renderWatched('/settings/plugins/postiz', rejected);
    fireEvent.click(await screen.findByRole('button', { name: 'Import from clipboard' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import from clipboard' })).toHaveProperty('disabled', false);
  });

  it('shows setup guidance without querying tools while inactive, and allows reading a skill', async () => {
    const tools: Watch = { namespace: 'plugins', procedure: 'tools' };
    const skill: Watch = { namespace: 'plugins', procedure: 'readSkill' };
    const { callsTo, router } = await renderWatched('/settings/plugins/postiz/tools', [tools, skill]);
    expect(await screen.findByText('Connect and activate this plugin to discover its tools.')).toBeTruthy();
    expect(callsTo(tools)).toEqual([]);
    await act(async () => {
      await router.navigate({ to: '/settings/plugins/$pluginId/skills', params: { pluginId: 'postiz' } });
    });
    fireEvent.click((await screen.findAllByRole('button', { name: 'Read skill' }))[0]!);
    await waitFor(() => expect(callsTo(skill)).toEqual([{ pluginId: 'postiz', skillId: 'publish' }]));
    expect(await screen.findByRole('button', { name: 'Hide skill' })).toBeTruthy();
  });

  it('enables all access by default on credential import and shows connection verification feedback', async () => {
    const { controls } = await renderApp('/settings/plugins/postiz', {
      plugins: { connected: true, enabled: false, access: ['posts-write'] },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Replace from clipboard' }));
    expect(await screen.findByText('Active')).toBeTruthy();
    expect(controls.plugins.get().enabled).toBe(true);
    expect(controls.plugins.get().grantedAccess).toEqual([
      'channels-read',
      'channels-write',
      'posts-read',
      'posts-write',
      'analytics-read',
      'media-read',
      'media-write',
      'media-generate',
      'mcp-extended',
    ]);
    expect(
      screen.getByRole('switch', { name: 'Let the AI use this plugin' }).getAttribute('aria-checked'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Connection verified')).toBeTruthy();
  });

  it('lists Instagram Edits with its bundled icon, imports its token, and activates it with all access', async () => {
    const { callsTo, controls, router } = await renderWatched('/settings/plugins', IMPORT);
    const row = await screen.findByRole('link', { name: /Instagram Edits.*Sync trending Instagram audio/ });
    expect(row.querySelector('img')?.getAttribute('src')).toBe('/plugins/instagram-edits.svg');
    await act(async () => {
      fireEvent.click(row);
    });
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/settings/plugins/instagram-edits/connection'),
    );
    expect(await screen.findByRole('heading', { name: /Instagram Edits/, level: 1 })).toBeTruthy();
    expect(await screen.findByLabelText('Edits MCP URL')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Import from clipboard' }));
    expect(await screen.findByText('Credential saved')).toBeTruthy();
    expect(await screen.findByText('Active')).toBeTruthy();
    expect(callsTo(IMPORT)).toEqual([{ pluginId: 'instagram-edits', credentialId: 'access-token' }]);
    expect(controls.plugins.get('instagram-edits').configuredCredentials).toEqual(['access-token']);
    expect(controls.plugins.get('instagram-edits').enabled).toBe(true);
    expect(controls.plugins.get('instagram-edits').grantedAccess).toEqual([
      'music-read',
      'projects-read',
      'projects-write',
      'ai-coprocessor',
      'mcp-extended',
    ]);
  });
});
