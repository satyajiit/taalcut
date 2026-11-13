// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/**/*.test.ts'],
          exclude: ['test/worker.pool.test.ts'],
          // The publish flow spawns the hub scripts. Five seconds is the default, and a full suite blows past it.
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        plugins: [
          cloudflareTest({
            remoteBindings: false,
            wrangler: { configPath: './wrangler.jsonc' },
            // Placeholder secrets so the configuration check passes; nothing in the pool test reaches GitHub.
            miniflare: {
              bindings: {
                GITHUB_APP_ID: '1',
                GITHUB_APP_INSTALLATION_ID: '1',
                GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----\n',
                INSTALL_ID_SALT: 'pool-test-salt-not-a-secret-0123456789',
              },
            },
          }),
        ],
        test: {
          name: 'workers',
          include: ['test/worker.pool.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
          // Workerd's node:fs cannot read the host fs-module cache, so a cached transform throws ENOENT.
          fsModuleCache: false,
        },
      },
    ],
  },
});
