// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1-PKG: ⌘K shows and binds a command's shortcut for this computer's keyboard, as the app menu does. On a PC
 * (Linux, Windows) the sidebar is Ctrl+B: core's ⌃⌘S would be Ctrl+S there, which is Save.
 */
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { onKeyboard, uiCommand } from '../src/features/palette/ui-command';

describe('onKeyboard', () => {
  const { controls } = createFakeBackend();
  const listed = controls.bus.list();
  const on = (keyboard: 'mac' | 'pc') =>
    new Map(listed.map((info) => [info.name, onKeyboard(info, keyboard)]));

  it('binds the sidebar with ⌃⌘S on a Mac and Ctrl+B on a PC', () => {
    expect(uiCommand(on('mac'), 'view.sidebar')).toEqual({ command: 'view.sidebar', shortcut: 'ctrl+mod+s' });
    expect(uiCommand(on('pc'), 'view.sidebar')).toEqual({ command: 'view.sidebar', shortcut: 'mod+b' });
  });

  it('leaves every other command as the bus lists it, on either keyboard', () => {
    for (const keyboard of ['mac', 'pc'] as const) {
      const commands = on(keyboard);
      for (const info of listed)
        if (info.name !== 'view.sidebar') expect(commands.get(info.name), info.name).toBe(info);
    }
    expect(uiCommand(on('pc'), 'edit.undo')).toEqual({ command: 'edit.undo', shortcut: 'mod+z' });
  });
});
