// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { FoldShift, ScrollArea } from '@taalcut/ui';
import type { ReactNode } from 'react';
import { Sidebar } from './sidebar';

/**
 * The app shell: the sidebar with the four areas and your chats, and the page
 * beside it. The window bar above both is the root's; its left band is the
 * sidebar's top. ⌃⌘S (Ctrl+B on a PC) folds the sidebar to its icon rail; the page takes its
 * new width once and slides with the sidebar's edge on the compositor. The
 * shell itself doesn't follow the fold, so the page never re-renders for it.
 * The shell's pages use it (routes/_shell.tsx), and so does a page that isn't
 * found, so you can always go on from there.
 */
export function ShellFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full overflow-hidden bg-canvas text-ink">
      <Sidebar />
      <FoldShift className="flex min-w-0 flex-1">
        <ScrollArea className="flex-1">
          {/* Skip to content focuses it; a landmark is not a control, so it takes no ring. */}
          <main id="main" className="flex min-h-full flex-col focus:outline-none">
            {children}
          </main>
        </ScrollArea>
      </FoldShift>
    </div>
  );
}
