// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Errors raised by the registry and the executor. Errors a tool raises itself
 * are defined in its own package. Timeouts and cancellations use core's
 * TimeoutError ('core.timeout', retryable) and CancelledError.
 */
import { defineError } from '@taalcut/core';

type ToolParams = { tool: string };

/** A module failed its checks; `detail` lists every problem. Nothing from it was registered. */
export const ToolRegistrationFailed = defineError<{ module: string }>('tools.registration_failed');
export const ToolNotFound = defineError<ToolParams>('tools.not_found');
/** The input did not match the tool's schema; `detail` has the zod issues so the model can fix its call. */
export const ToolInvalidInput = defineError<ToolParams>('tools.invalid_input');
/** The tool returned something that doesn't match its own output schema: a bug in the tool. */
export const ToolInvalidOutput = defineError<ToolParams>('tools.invalid_output');
/** Settings don't allow what the tool needs (local-only mode, a filesystem scope, the network). */
export const ToolPermissionDenied = defineError<ToolParams>('tools.permission_denied');
/** The user or the agent's policy said no. */
export const ToolDenied = defineError<ToolParams>('tools.denied');
/** The policy is waiting for the user (approval or budget card); the run should pause and resume later. */
export const ToolAwaitingApproval = defineError<ToolParams>('tools.awaiting_approval');
/** A destructive or external tool was allowed without an approval id. */
export const ToolApprovalRequired = defineError<ToolParams>('tools.approval_required');
/** The tool threw instead of returning an Err: a bug. `detail` has the error's name and scrubbed message. */
export const ToolCrashed = defineError<ToolParams>('tools.crashed');
/**
 * A tool that changes state was called with no `runId` (or `scope`): there is
 * nothing to scope its idempotency key to, so repeats couldn't be told apart.
 */
export const ToolScopeRequired = defineError<ToolParams>('tools.scope_required');
/** A service the tool needs (command bus, artifact store) isn't wired in this process. */
export const ToolServiceUnavailable = defineError<{ service: string }>('tools.service_unavailable');
