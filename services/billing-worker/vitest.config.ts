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
          // The bundle test runs wrangler's dry-run build.
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        plugins: [
          cloudflareTest({
            remoteBindings: false,
            wrangler: { configPath: './wrangler.jsonc' },
            // A placeholder key pair, and the switch on whatever the deployed file says, so the Worker reads as
            // selling; nothing in the pool test reaches the provider.
            miniflare: {
              bindings: {
                SELLING: 'on',
                RAZORPAY_KEY_ID: 'rzp_live_PoolTest000000',
                RAZORPAY_KEY_SECRET: 'pool-test-key-secret-not-a-secret',
                RAZORPAY_WEBHOOK_SECRET: 'pool-test-webhook-secret-not-a-secret',
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
