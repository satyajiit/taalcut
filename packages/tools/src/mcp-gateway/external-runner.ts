// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The port the gateway runs calls through (P3-V4; platform request §24). `packages/agent` implements it
 * (`createExternalRunner`): one long-lived run of kind `external` per session, no model loop, the agent's own
 * ToolPolicy at autonomy `before-render`, so Local only, budgets, upload consent, cost estimates and approval
 * cards apply to an MCP client exactly as to the built-in agent. The exact shape is pinned in
 * `_orch/p3/specs/mcp-release-to-models-agent.md`.
 */
import type {
  AsyncResult,
  ConversationId,
  McpClientKind,
  McpLevel,
  McpSessionId,
  RunId,
} from '@taalcut/core';
import type { ToolResult } from '../ports';

/** Who asked: goes on approval, consent and budget cards as `approvalCardSchema.requester`. */
export interface McpRequester {
  readonly kind: 'mcp';
  readonly sessionId: McpSessionId;
  /** The session's name, e.g. "Claude Code on this Mac". */
  readonly name: string;
}

export interface ExternalRunSession {
  readonly sessionId: McpSessionId;
  readonly name: string;
  readonly client: McpClientKind;
}

export interface ExternalRunHandle {
  readonly runId: RunId;
  readonly conversationId: ConversationId;
}

export interface McpOrigin {
  readonly source: 'mcp';
  /** 'mcp:<sessionId>'. */
  readonly actor: string;
}

export interface ExternalCallOptions {
  /**
   * sha256 hex naming this call for the runner; derive the tool call id from it. The gateway passes the same key
   * again only when a client repeats a call (same session, tool, arguments and day) that is waiting for the
   * person's approval, so the repeat resumes the deferred call; any other call, a repeat of a finished one
   * included, gets a new key and runs.
   */
  readonly callKey: string;
  /** The session's level; the gateway has already refused tools above it. */
  readonly level: McpLevel;
  /** Every command the tool dispatches carries it. */
  readonly origin: McpOrigin;
  readonly requester: McpRequester;
  /** How long a deferred call is held for the person before the answer is `pending`. */
  readonly holdMs: number;
  /** Revoke, the client cancelling, or the process going: a running tool sees core.cancelled. */
  readonly signal?: AbortSignal;
  /** Tool progress, and ticks while an approval is held. */
  readonly onProgress?: (fraction: number | null, message?: string) => void;
}

export type ExternalCallOutcome =
  /** Ran, or was de-duplicated / served from the run's log. */
  | { readonly kind: 'done'; readonly result: ToolResult }
  /** Still waiting for the person after `holdMs`; nothing ran. The same call later resumes it. */
  | { readonly kind: 'pending'; readonly approvalId: string }
  /** The person declined it in the app. */
  | { readonly kind: 'declined' };

export interface ExternalRunner {
  /** One run of kind 'external' and one conversation titled with the session's name. */
  open(session: ExternalRunSession): AsyncResult<ExternalRunHandle>;
  /** A tool's own error comes back as err(error); the gateway turns it into an `isError` result. */
  call(
    runId: RunId,
    name: string,
    input: unknown,
    options: ExternalCallOptions,
  ): AsyncResult<ExternalCallOutcome>;
  /** Revoke or expiry: cancels calls in flight, expires pending approvals, ends the run. Idempotent. */
  close(runId: RunId, reason: 'revoked' | 'expired'): AsyncResult<void>;
}
