// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX2-FIXUP: the fix buttons that open a pane of System Settings. A fix sends core's UI command, main answers with a
// `ui.action`, and the window asks main to open the pane (`files.openSystemSettings`, which opens only its fixed
// URL). `system.openFilesAndFolders` had no handler, so "Open Files and Folders" did nothing; and the Library's
// add-folder toast and first run's folder source showed the refusal without its fix (UX2-FIXUP round 2).
import { IMPORT_COMMANDS, defineError, LIBRARY_COMMANDS, toRpcError } from '@taalcut/core';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { freshMac, openWay, press } from './onboarding/onboarding-dom';
import { renderWatched, type Watch } from './settings/spied-backend';

const SETTINGS: Watch = { namespace: 'files', procedure: 'openSystemSettings' };

/** packages/library's error as it declares it (the renderer can't import library): macOS refused the folder. */
const FolderPermissionDenied = defineError<{ readonly path: string; readonly name: string }>(
  'library.folder_permission_denied',
  { fix: { command: 'system.openFilesAndFolders', labelKey: 'fix.openFilesAndFolders' } },
);

/** A dispatched command's name. */
const nameOf = (input: unknown): unknown =>
  typeof input === 'object' && input !== null && 'name' in input ? input.name : undefined;

/** Adding a folder, refused by macOS; every other command goes to the fake as usual. */
const REFUSE_ADD: Watch = {
  namespace: 'commands',
  procedure: 'dispatch',
  answer: (input, fake) =>
    nameOf(input) === LIBRARY_COMMANDS.addSource || nameOf(input) === IMPORT_COMMANDS.createDraft
      ? Promise.reject(toRpcError(FolderPermissionDenied({ path: '/Users/me/Private', name: 'Private' })))
      : fake(),
};

type Rendered = Awaited<ReturnType<typeof renderWatched>>;

/**
 * Main's `ui.action` for `action`, sent until the window carries it out: the palette's chunk, which runs them, loads
 * right after the first frame, and events arrive a moment after they are sent, so a few may go out.
 */
async function menu({ controls, callsTo }: Rendered, action: string) {
  await waitFor(() => {
    controls.events.emit('ui.action', { action });
    expect(callsTo(SETTINGS).length).toBeGreaterThan(0);
  });
}

/** The panes main was asked to open, in order. */
const panes = ({ callsTo }: Rendered) =>
  callsTo(SETTINGS).map((call) =>
    typeof call === 'object' && call !== null && 'pane' in call ? call.pane : undefined,
  );

describe('fix buttons that open System Settings', () => {
  it.for([
    ['system.openFilesAndFolders', 'filesAndFolders'],
    ['system.openStorage', 'storage'],
  ] as const)('%s opens the %s pane, through main', async ([action, pane]) => {
    const rendered = await renderWatched('/chat', SETTINGS);
    await menu(rendered, action);
    expect(new Set(panes(rendered))).toEqual(new Set([pane]));
  });

  it('Settings › Sources: a folder macOS won’t let Taalcut read offers Files and Folders, which opens it', async () => {
    const rendered = await renderWatched('/settings/sources', [SETTINGS, REFUSE_ADD]);
    // The window carries out main's actions once its palette chunk is in: a Storage fix first, to know it is.
    await menu(rendered, 'system.openStorage');
    await act(async () => {
      fireEvent.click(await screen.findByRole('link', { name: 'Add folder…' }));
    });
    await press('[data-action=import-connect]');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Private');
    expect(panes(rendered)).not.toContain('filesAndFolders');
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Open Files and Folders' }));
    });
    await waitFor(() => expect(panes(rendered).filter((pane) => pane === 'filesAndFolders')).toHaveLength(1));
  });

  it('Library: a refused draft offers Files and Folders, which opens it', async () => {
    const rendered = await renderWatched('/library/import/folder', [SETTINGS, REFUSE_ADD]);
    await menu(rendered, 'system.openStorage');
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Choose folder…' }));
    });
    const open = await screen.findByRole('button', { name: 'Open Files and Folders' });
    expect(panes(rendered)).not.toContain('filesAndFolders');
    await act(async () => {
      fireEvent.click(open);
    });
    await waitFor(() => expect(panes(rendered).filter((pane) => pane === 'filesAndFolders')).toHaveLength(1));
  });

  it('first run: a folder macOS won’t let Taalcut read offers Files and Folders, which opens it', async () => {
    const rendered = await renderWatched('/onboarding/sources', [SETTINGS, REFUSE_ADD], freshMac());
    await menu(rendered, 'system.openStorage');
    await openWay('folder');
    await press('[data-action="import-connect"]');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Private');
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Open Files and Folders' }));
    });
    await waitFor(() => expect(panes(rendered).filter((pane) => pane === 'filesAndFolders')).toHaveLength(1));
  });
});
