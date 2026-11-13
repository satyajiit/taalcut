// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Worker's variables and secrets, checked once per request before any route reads them. A missing or
 * malformed one is `hub.not_configured` (503), never an empty salt or a half-built GitHub client. The values are
 * never echoed: a failure names nothing but the code.
 */
import { z } from 'zod';

import { type AppCredentials } from '../github/app-token';

const envSchema = z.object({
  HUB_REPO: z.string().regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/),
  GITHUB_APP_ID: z.string().regex(/^\d{1,20}$/),
  GITHUB_APP_INSTALLATION_ID: z.string().regex(/^\d{1,20}$/),
  GITHUB_APP_PRIVATE_KEY: z.string().includes('PRIVATE KEY-----'),
  /** HMAC key for install hashes: 32 characters at least (`openssl rand -base64 32` gives 44). */
  INSTALL_ID_SALT: z.string().min(32),
});

export interface HubConfig {
  repo: string;
  app: AppCredentials;
  salt: string;
}

export function hubConfig(env: unknown): HubConfig | null {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) return null;
  const { HUB_REPO, GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY, INSTALL_ID_SALT } =
    parsed.data;
  return {
    repo: HUB_REPO,
    app: {
      appId: GITHUB_APP_ID,
      installationId: GITHUB_APP_INSTALLATION_ID,
      privateKeyPem: GITHUB_APP_PRIVATE_KEY,
    },
    salt: INSTALL_ID_SALT,
  };
}
