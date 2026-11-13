// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* global window, document */

// Applies a stored light or dark choice before first paint, so a browser build
// never flashes the wrong theme. Load it as an external, classic (non-module)
// script in <head>, before any stylesheet:
//
//   <script src="/theme-boot.js"></script>
//
// It is a separate file, not inline, because the app's CSP is script-src 'self'.
// The renderer's Vite config serves it at /theme-boot.js and copies it into
// dist/. "system" needs nothing: the CSS already follows prefers-color-scheme.
// In Electron the main process sets nativeTheme.themeSource and the window
// background before the page loads; this script then finds nothing stored and
// leaves <html> alone. The storage key matches THEME_STORAGE_KEY.
(function () {
  var pref = 'system';
  try {
    var stored = window.localStorage.getItem('taalcut.theme');
    if (stored === 'light' || stored === 'dark') pref = stored;
  } catch {
    // Storage blocked: fall back to system.
  }
  var root = document.documentElement;
  if (pref !== 'system') root.setAttribute('data-theme', pref);
  root.setAttribute('data-theme-preference', pref);
})();
