// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The standing upload consents' token, on its own so the pictures rule (agent-designer.ts, agent-eyes.ts) can read
 * the store without importing the agent loop that composes the tools that use it. agent-loop.ts registers it.
 */
import { createToken } from '@taalcut/core';
import type { ConsentStore } from '@taalcut/agent';

/** Standing upload consents ("Always allow"), kept in Settings; appContract.consents lists and revokes them. */
export const ConsentStoreToken = createToken<ConsentStore>('agent.consents');
