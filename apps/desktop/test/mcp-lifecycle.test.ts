// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Whether the mcp process runs (D18: only while External agents is on, on the chosen port), what it inherits from
 * main's environment (SB-15), and where the stdio setup text points.
 */
import {
  createEventBus,
  createMemorySettingsStore,
  MCP_COMMANDS,
  MCP_ENABLED_SETTING,
  MCP_PORT_SETTING,
  newId,
  type UtilityName,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { mcpProcessEnv } from '../src/main/mcp/mcp-env';
import { createMcpLifecycle } from '../src/main/mcp/mcp-lifecycle';
import { mcpShimPath } from '../src/main/mcp/mcp-main';
import { utilityForkEnv } from '../src/main/composition/fork-env';

function world() {
  const settings = createMemorySettingsStore();
  const events = createEventBus({ clock: { now: () => 1 } });
  const log: string[] = [];
  const host = {
    start: (process: UtilityName) => void log.push(`start ${process}`),
    stop: async (process: UtilityName) => void log.push(`stop ${process}`),
  };
  const lifecycle = createMcpLifecycle({ settings, events, host, log: () => undefined });
  const changed = async (name: string) => {
    events.emit('command.changed', {
      kind: 'executed',
      id: newId<'Command'>(),
      name,
      projectId: null,
      source: 'ui',
      actor: 'user',
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
  };
  return { settings, lifecycle, log, changed };
}

describe('the mcp process lifecycle', () => {
  it('stays off by default and starts when External agents is turned on', async () => {
    const { settings, lifecycle, log, changed } = world();
    await lifecycle.start();
    expect(log).toEqual([]);
    expect(lifecycle.port()).toBe(41730);
    await settings.set(MCP_ENABLED_SETTING, true);
    await changed(MCP_COMMANDS.setEnabled);
    expect(log).toEqual(['start mcp']);
    await changed(MCP_COMMANDS.renameSession);
    expect(log).toEqual(['start mcp']);
    lifecycle.dispose();
  });

  it('restarts on a new port and stops when turned off (the port closes)', async () => {
    const { settings, lifecycle, log, changed } = world();
    await settings.set(MCP_ENABLED_SETTING, true);
    await lifecycle.start();
    await settings.set(MCP_PORT_SETTING, 42000);
    await changed(MCP_COMMANDS.setPort);
    expect(lifecycle.port()).toBe(42000);
    await settings.set(MCP_ENABLED_SETTING, false);
    await changed(MCP_COMMANDS.setEnabled);
    expect(log).toEqual(['start mcp', 'stop mcp', 'start mcp', 'stop mcp']);
    lifecycle.dispose();
    await settings.set(MCP_ENABLED_SETTING, true);
    await changed(MCP_COMMANDS.setEnabled);
    expect(log).toHaveLength(4);
  });

  it('logs a stop that failed after a command, and applies the next change', async () => {
    const settings = createMemorySettingsStore();
    const events = createEventBus({ clock: { now: () => 1 } });
    const done: string[] = [];
    const logged: string[] = [];
    let stops = 0;
    const host = {
      start: (process: UtilityName) => void done.push(`start ${process}`),
      stop: async (process: UtilityName) => {
        stops += 1;
        if (stops === 1) throw new Error('the process did not stop');
        done.push(`stop ${process}`);
      },
    };
    const lifecycle = createMcpLifecycle({ settings, events, host, log: (line) => void logged.push(line) });
    const changed = async (name: string) => {
      events.emit('command.changed', {
        kind: 'executed',
        id: newId<'Command'>(),
        name,
        projectId: null,
        source: 'ui',
        actor: 'user',
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
    };
    await settings.set(MCP_ENABLED_SETTING, true);
    await lifecycle.start();
    await settings.set(MCP_ENABLED_SETTING, false);
    await changed(MCP_COMMANDS.setEnabled);
    expect(logged).toEqual(['[mcp] change not applied: Error: the process did not stop']);
    await changed(MCP_COMMANDS.setEnabled);
    expect(done).toEqual(['start mcp', 'stop mcp']);
    lifecycle.dispose();
  });
});

describe('the mcp process environment', () => {
  it('keeps home, temp, PATH and locale, and nothing else of main’s', () => {
    expect(
      mcpProcessEnv({
        HOME: '/Users/a',
        TMPDIR: '/var/t',
        PATH: '/usr/bin',
        LANG: 'en_IN.UTF-8',
        OPENAI_API_KEY: 'sk-secret',
        NODE_OPTIONS: '--require /x.js',
        HTTPS_PROXY: 'http://proxy',
      }),
    ).toEqual({ HOME: '/Users/a', TMPDIR: '/var/t', PATH: '/usr/bin', LANG: 'en_IN.UTF-8' });
    expect(utilityForkEnv('agent')).toEqual({});
    expect(Object.keys(utilityForkEnv('mcp', { NODE_OPTIONS: '--require /x.js' }).env ?? {})).toEqual([]);
  });

  it('names the app’s own shim when packaged, and the repo build in development', () => {
    expect(
      mcpShimPath({
        packaged: true,
        resourcesPath: '/A/Taalcut.app/Contents/Resources',
        appPath: '/ignored',
      }),
    ).toBe('/A/Taalcut.app/Contents/Resources/bin/taalcut');
    expect(mcpShimPath({ packaged: false, resourcesPath: '/r', appPath: '/repo/apps/desktop' })).toBe(
      '/repo/native/taalcut-cli/dist/taalcut',
    );
  });
});
