// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The theme as electronStore wants it: get, set, and changes made elsewhere.
 * It lives in @taalcut/core, which builds one on the theme contract
 * (themeBridgeOverRpc): main owns the saved preference and keeps
 * nativeTheme.themeSource in step with it. The renderer passes it to
 * defaultThemeStore; without one (a plain browser, tests) the engine uses
 * localStorage.
 */
export type { ThemeBridge } from '@taalcut/core';
