// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** One tools/call from an MCP client as the gateway receives it, and what running it needs. */
import type { Clock, McpSessionId } from '@taalcut/core';
import type { ToolRegistry } from '../registry';
import type { CallLedger } from './call-ledger';
import type { ExternalRunner } from './external-runner';
import type { NativeTool } from './history-tools';
import type { McpSessionStore } from './sessions';

export interface McpCallInput {
  readonly sessionId: McpSessionId;
  readonly callKey: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  readonly wantsProgress: boolean;
}

export interface CallFlowDeps {
  readonly sessions: Pick<McpSessionStore, 'get' | 'state'>;
  readonly registry: Pick<ToolRegistry, 'resolve'>;
  readonly runner: ExternalRunner;
  readonly natives: ReadonlyMap<string, NativeTool>;
  readonly ledger: CallLedger;
  readonly clock: Clock;
  readonly holdMs: number;
  readonly progressEveryMs: number;
}
