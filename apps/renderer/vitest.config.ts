// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { lingui } from '@lingui/vite-plugin';
import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

// Unit tests in jsdom. The browser-level checks (pseudo-locale, screenshots,
// CSP, theme flash) are Playwright tests in e2e/.
export default defineConfig({
  define: { __TAALCUT_VERSION__: JSON.stringify(pkg.version) },
  plugins: [lingui({ macroTransform: true })],
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
});
