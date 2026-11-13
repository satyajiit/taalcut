// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { testCores } from './test-budget/cores.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  root,
  test: {
    environment: 'node',
    maxWorkers: testCores(),
    include: ['scripts/**/*.test.ts'],
  },
});
