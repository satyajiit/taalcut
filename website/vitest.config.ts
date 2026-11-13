// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // tsconfig keeps JSX for Next (`preserve`); the unit tests render components to HTML, so Vite compiles it here.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['test/unit/**/*.test.ts', 'firebase/test/**/*.test.ts'],
    environment: 'node',
  },
});
