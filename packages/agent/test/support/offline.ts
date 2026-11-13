// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-I3 (agent half): every agent test file runs with the network off. Model
 * answers come from scripts, from the run log (replay) or from recorded HTTP
 * cassettes; any attempt to reach the network fails the suite. The one
 * exception is re-recording cassettes (TAALCUT_RECORD=1), which talks to a
 * local Ollama.
 */
import { cassetteModeFromEnv, disableNetwork } from '@taalcut/models';
import { afterAll } from 'vitest';

if (cassetteModeFromEnv() !== 'record') {
  const guard = disableNetwork();
  afterAll(() => {
    const blocked = [...guard.blocked];
    guard.restore();
    if (blocked.length > 0) throw new Error(`Agent tests tried to use the network: ${blocked.join(', ')}`);
  });
}
