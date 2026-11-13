// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/// <reference types="vite/client" />

/** The renderer's package version, set by Vite's `define` (vite.config.ts). */
declare const __TAALCUT_VERSION__: string;

// Catalogues compiled on import by @lingui/vite-plugin.
declare module '*.po' {
  import type { Messages } from '@lingui/core';
  export const messages: Messages;
}
