// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The fake chat's options, and how the end-to-end tests and manual demos set them (moved out of fake-client.ts). */
import { isRecoveryScenario, type RecoveryScenario } from '../recovery/fake-recovery';

export interface FakeOptions {
  /** Delay before list and get answer, like an IPC round trip to a busy process. */
  latencyMs?: number;
  /** Multiplies the script's pace: 2 runs twice as fast. 0 means no waiting at all. */
  speed?: number;
  /** Command names whose dispatch fails (an error card's fix that doesn't work). */
  failCommands?: readonly string[];
  /** What the fake recovery client reports at launch (src/recovery/fake-recovery.ts). */
  recovery?: RecoveryScenario;
  /** 'cap': a flow stops at the project's budget before casting (P2-X1). */
  budget?: 'cap';
  /**
   * A run holds after this event type until stopped. An optional occurrence suffix (agent.toolStarted:12)
   * selects a later event; without it the first match holds. Used for stable mid-run browser checks.
   */
  holdAfter?: string;
  now?: () => number;
}

/** localStorage key holding FakeOptions as JSON, for the end-to-end tests and manual demos. */
export const FAKE_OPTIONS_KEY = 'taalcut.fake';

export function fakeOptionsFromStorage(): FakeOptions {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(FAKE_OPTIONS_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    const { latencyMs, speed, failCommands, recovery, budget, holdAfter } = parsed as Record<string, unknown>;
    return {
      ...(typeof latencyMs === 'number' ? { latencyMs } : {}),
      ...(typeof speed === 'number' ? { speed } : {}),
      ...(Array.isArray(failCommands) ? { failCommands: failCommands.map(String) } : {}),
      ...(isRecoveryScenario(recovery) ? { recovery } : {}),
      ...(budget === 'cap' ? { budget } : {}),
      ...(typeof holdAfter === 'string' ? { holdAfter } : {}),
    };
  } catch {
    return {};
  }
}
