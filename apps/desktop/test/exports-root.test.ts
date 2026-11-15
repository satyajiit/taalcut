// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// FIX-EXPORTNAMES: finished videos go to the person's exports folder, ~/Movies/Taalcut/Exports, for the app's own
// data folder; a run on any other data folder (tests, e2e: --user-data-dir) keeps them inside it.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { macExportsRoot, windowsExportsRoot, xdgExportsRoot } from '../src/platform/exports-roots';
import { exportsFolder, legacyExportsFolder } from '../src/shared/export-paths';
import { exportsRoot, renderPaths } from '../src/shared/render-paths';

describe('the exports folder', () => {
  it('is Movies/Taalcut/Exports for the app’s own data folder, on each system', () => {
    expect(macExportsRoot('/Users/me/Library/Application Support/Taalcut', '/Users/me')).toBe(
      '/Users/me/Movies/Taalcut/Exports',
    );
    expect(
      windowsExportsRoot(
        join('C:/Users/me/AppData/Roaming', 'Taalcut'),
        { APPDATA: 'C:/Users/me/AppData/Roaming' },
        'C:/Users/me',
      ),
    ).toBe(join('C:/Users/me', 'Movies', 'Taalcut', 'Exports'));
    expect(xdgExportsRoot('/home/me/.config/Taalcut', {}, '/home/me')).toBe(
      '/home/me/Movies/Taalcut/Exports',
    );
    expect(xdgExportsRoot('/home/me/.cfg/Taalcut', { XDG_CONFIG_HOME: '/home/me/.cfg' }, '/home/me')).toBe(
      '/home/me/Movies/Taalcut/Exports',
    );
    // A relative XDG_CONFIG_HOME is ignored, as the spec says.
    expect(xdgExportsRoot('/home/me/.config/Taalcut', { XDG_CONFIG_HOME: 'cfg' }, '/home/me')).toBe(
      '/home/me/Movies/Taalcut/Exports',
    );
  });

  it('stays inside any other data folder, so a test never writes into the person’s Movies', () => {
    for (const userData of [
      '/var/folders/xy/T/taalcut-e2e-abc',
      '/tmp/taalcut-user-data',
      '/Users/me/Library/Application Support/Taalcut/profiles/second',
      '/Users/me/Library/Application Support',
    ])
      expect(macExportsRoot(userData, '/Users/me')).toBe(join(userData, 'Exports'));
  });

  it('is one folder for the videos and for what the agent’s sink writes; the earlier sink folder is kept', () => {
    const userData = '/tmp/taalcut-user-data';
    expect(renderPaths(userData).exports).toBe(join(userData, 'Exports'));
    expect(exportsRoot(userData, { exportsRoot: (data) => `${data}/elsewhere` })).toBe(
      `${userData}/elsewhere`,
    );
    expect(exportsFolder(userData)).toBe(renderPaths(userData).exports);
    expect(renderPaths(userData).renders).toBe(join(userData, 'renders'));
    expect(legacyExportsFolder(userData)).toBe(join(userData, 'exports'));
  });
});
