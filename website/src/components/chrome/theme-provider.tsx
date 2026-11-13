// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

import { ThemeProvider as NextThemes } from 'next-themes';
import type { ReactNode } from 'react';

/**
 * Light by default, dark on request (the owner's call for the site; the app itself follows the Mac). next-themes
 * sets `data-theme` on <html> before first paint, which is the attribute the tokens key on.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemes attribute="data-theme" defaultTheme="light" enableSystem={false} storageKey="taalcut.theme" disableTransitionOnChange>
      {children}
    </NextThemes>
  );
}
