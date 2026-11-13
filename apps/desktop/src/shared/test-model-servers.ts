// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Test builds only (TAALCUT_BUILD_FLAVOUR=test): points the model providers
 * and Sign in with ChatGPT at local mock servers, so gate criterion 4
 * (e2e/gate-models.e2e.ts) runs the real sign-in, key and model-switch paths
 * offline. Main and the agent process reach this module only inside
 * `__TAALCUT_FLAVOUR__ === 'test'` through import(), so release bundles don't
 * contain it.
 *
 *   TAALCUT_TEST_MODEL_SERVERS='{"baseUrls":{"openai":"http://127.0.0.1:…/v1","anthropic":"…"},
 *                                "chatgpt":{"authorizeUrl":"…","tokenUrl":"…"}}'
 *
 * Loopback URLs only: a test build can't be pointed at another machine.
 */
import type { ModelRuntimeOptions } from '@taalcut/models';
import { z } from 'zod';

export const MODEL_SERVERS_ENV = 'TAALCUT_TEST_MODEL_SERVERS';

const loopback = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
}, 'a loopback http URL');

const modelServersSchema = z.object({
  baseUrls: z.record(z.string(), loopback),
  chatgpt: z.object({ authorizeUrl: loopback, tokenUrl: loopback }).optional(),
});

/** The runtime options the variable asks for, or undefined when it isn't set. Throws when it is malformed. */
export function testModelServers(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Pick<ModelRuntimeOptions, 'baseUrlOverrides' | 'signIn'> | undefined {
  const raw = env[MODEL_SERVERS_ENV];
  if (!raw) return undefined;
  const servers = modelServersSchema.parse(JSON.parse(raw));
  return {
    baseUrlOverrides: servers.baseUrls,
    // The mock issuer accepts any loopback redirect, so the callback takes a free port.
    ...(servers.chatgpt ? { signIn: { chatgpt: { ...servers.chatgpt, callbackPort: 0 } } } : {}),
  };
}
