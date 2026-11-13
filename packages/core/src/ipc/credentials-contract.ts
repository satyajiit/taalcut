// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Credentials between main and the agent process (models SPEC, "Auth token
 * flow"). Main's AuthBroker keeps keys and refresh tokens; the agent's
 * ModelClient asks it for what one request needs (an API key or a
 * short-lived access token) and caches it. Never part of appContract: no
 * page can call these, and nothing here is logged.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { ipc } from './contract';

/** models' ResolvedCredential. `secret` is the key or access token itself. */
export const resolvedCredentialSchema = z.object({
  kind: z.enum(['api_key', 'oauth_access', 'none']),
  secret: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  baseUrl: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  expiresAt: z.int().nonnegative().optional(),
  source: z.string(),
});
export type ResolvedCredentialWire = z.output<typeof resolvedCredentialSchema>;

const provider = z.string().min(1).max(100);

/** Served by main to the agent process. */
export const credentialsContract = {
  /** null when the provider isn't set up. */
  get: ipc
    .input(
      z.object({
        provider,
        minValidityMs: z.int().nonnegative().optional(),
        /** The provider rejected the last token (HTTP 401). */
        forceRefresh: z.boolean().optional(),
      }),
    )
    .output(resolvedCredentialSchema.nullable()),
  /** The provider rejected this credential: refresh it next time. */
  invalidate: ipc.input(z.object({ provider })).output(z.void()),
  /** Cloud providers with a key or a sign-in (the model picker's 'not-configured'). Ids only, never a secret. */
  configured: ipc.output(z.array(provider).max(200)),
};

/** Served by the agent process to main: a key, sign-in or local server changed, so drop the cached copy. */
export const credentialChangesContract = {
  forget: ipc.input(z.object({ provider })).output(z.void()),
};
