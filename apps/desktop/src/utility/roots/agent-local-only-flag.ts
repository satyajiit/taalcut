// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Local only flag's token, on its own so a root that agent-flows reaches (agent-workspace-tools, through
 * agent-render) can read it without importing agent-flows back. agent-flows re-exports it and registers it.
 */
import { createToken } from '@taalcut/core';

/** Settings → Privacy → Local only, as last read. */
export interface LocalOnlyFlag {
  get(): boolean;
  /** Reads the setting again (at start, and after privacy.setLocalOnly). */
  refresh(): Promise<void>;
}

export const LocalOnlyFlagToken = createToken<LocalOnlyFlag>('agent.localOnlyFlag');
