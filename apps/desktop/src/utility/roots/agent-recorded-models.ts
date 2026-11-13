// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Test builds only (TAALCUT_BUILD_FLAVOUR=test): the agent process's models
 * replay recorded sessions (apps/gate-demo) instead of calling a provider,
 * so the e2e runs drive the real app offline and free: the gate demo's
 * (e2e/gate.e2e.ts), the make flow's journeys (e2e/make-flow*.e2e.ts) and
 * the docked chat's change after one (EDT1-CTX, e2e/make-flow-edit-chat.e2e.ts).
 * agent.ts reaches this module only inside `__TAALCUT_FLAVOUR__ === 'test'`
 * through import(), so release bundles don't contain it.
 *
 *   TAALCUT_TEST_RECORDED_MODELS=<dir>   the folder holding the cassettes
 *   TAALCUT_RECORD=1 TAALCUT_RECORD_SESSION=make-flow
 *                                        record that session against the
 *                                        in-process stand-in provider (no
 *                                        key, no network, no cost)
 *
 * Both clients are real @taalcut/models clients (pi-ai parses the recorded
 * streams; every call gets its CloudCall row); only their fetch answers from
 * the cassette, so nothing leaves the process.
 */
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import type { CloudCallSink, ToolModule } from '@taalcut/core';
import {
  createRecordedModels,
  EDIT_CHAT_SESSION,
  EDIT_DESIGN_SESSION,
  GATE_DEMO_SESSION,
  isRecording,
  MAKE_FLOW_SESSION,
  recordCatalogues,
} from '@taalcut/gate-demo';
import type { ModelClient, ModelRequest } from '@taalcut/models';

export const RECORDED_MODELS_ENV = 'TAALCUT_TEST_RECORDED_MODELS';
const SESSIONS = [
  GATE_DEMO_SESSION,
  MAKE_FLOW_SESSION,
  EDIT_CHAT_SESSION,
  // HFW1-UI: the docked chat's designed headline (e2e/make-flow-edit-design.e2e.ts).
  EDIT_DESIGN_SESSION,
];

/** The recorded sessions' clients as one: vision calls go to the vision client, the rest to the agent's. */
export function recordedModelClient(fixturesDir: string): (callLog: CloudCallSink) => ModelClient {
  // Paths under the home folder (the test's temporary one) are recorded as under /Users/demo.
  const recorded = createRecordedModels(fixturesDir, {
    home: realpathSync(homedir()),
    sessions: SESSIONS,
  });
  return (callLog) => {
    const { agent, vision } = recorded(callLog);
    const pick = (request: ModelRequest) => (request.module === 'vision' ? vision : agent);
    return {
      stream: (request) => pick(request).stream(request),
      complete: (request) => pick(request).complete(request),
    };
  };
}

/**
 * While this process records a session (TAALCUT_RECORD=1, TAALCUT_RECORD_SESSION), the tools it offers are written
 * beside the cassette as the catalogue the session was recorded with (apps/gate-demo catalogue.ts), which
 * test/agent-catalogue.test.ts holds the agent to. `modules` is only read then.
 */
export function recordSessionCatalogues(modules: () => readonly ToolModule[]): void {
  const fixtures = process.env[RECORDED_MODELS_ENV];
  if (fixtures && SESSIONS.some(isRecording)) recordCatalogues(SESSIONS, modules(), fixtures);
}
