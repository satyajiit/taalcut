// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { CommandPalette, useCommandShortcuts } from '@taalcut/ui';
import { useMemo, useState } from 'react';
import { setPaletteOpen, usePaletteState } from './palette-state';
import { useFoundItems } from './use-found-items';
import { usePaletteItems } from './use-palette-items';
import { useUiActions } from './use-ui-actions';

/**
 * The palette and its items, a chunk of its own (it needs the backend's
 * contracts and core). Item shortcuts (⌘1–⌘4, ⌘,) are bound here, and the
 * app menu's `ui.action` events run the same items; ⌘K itself is bound in the
 * entry by PaletteMount. Once something is typed, your chats, projects, clips and templates are listed too, by name
 * (useFoundItems, UX4).
 */
export default function PaletteContent() {
  const { open, opened } = usePaletteState();
  const commands = usePaletteItems(opened);
  const [query, setQuery] = useState('');
  const found = useFoundItems(open ? query : '', opened);
  useCommandShortcuts(commands);
  useUiActions(commands);
  const items = useMemo(() => [...commands, ...found.items], [commands, found.items]);
  return (
    <CommandPalette
      open={open}
      onOpenChange={setPaletteOpen}
      items={items}
      onQueryChange={setQuery}
      searching={found.searching}
    />
  );
}
