// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { usePaletteShortcut } from '@taalcut/ui';
import { lazy, Suspense } from 'react';
import { togglePalette } from './palette-state';

// Loads right after the first frame, not on first use, so item shortcuts work at once.
const PaletteContent = lazy(() => import('./palette-content'));

/**
 * ⌘K, mounted once in the root layout (G28, P1-H6). ⌘K opens and closes it
 * from anywhere, even before the palette's chunk has arrived; item shortcuts
 * work whenever focus isn't in a text field or a dialog. Each open reloads
 * the bus's command list.
 */
export function PaletteMount() {
  usePaletteShortcut(togglePalette);
  return (
    <Suspense fallback={null}>
      <PaletteContent />
    </Suspense>
  );
}
