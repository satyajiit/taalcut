// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How a call ends for the MCP client (tools SPEC, "A call", steps 5 and 6). A result has the tool's structured
 * output (when it is an object, as MCP requires) and one text item: the output as JSON, or the artifact summary
 * when the executor spilled it. A Taalcut error is a tool result with `isError: true` (the client's model reads
 * it), never a JSON-RPC error; its text and `structuredContent` carry the code, the fix's label key and whether
 * trying again may work, and never `detail`.
 */
import type { McpCallItem, TaalcutError } from '@taalcut/core';
import { isPlainObject } from '../plain-object';
import type { ToolResult } from '../ports';
import { McpAwaitingApproval, McpDeclined, mcpErrorText } from './errors';

type ResultItem = Extract<McpCallItem, { type: 'result' }>;

/** The text item's bound (core's mcpCallItemSchema). */
const MAX_TEXT = 1_000_000;

function bounded(text: string): string {
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT - 1)}…`;
}

export function structuredItem(value: Record<string, unknown>): ResultItem {
  return { type: 'result', isError: false, structuredContent: value, text: bounded(JSON.stringify(value)) };
}

export function doneItem(result: ToolResult): ResultItem {
  const text =
    result.output.kind === 'inline'
      ? JSON.stringify(result.output.value ?? null)
      : `${result.output.ref.summary} (stored in Taalcut as ${result.output.ref.mediaType}, ${result.output.ref.bytes} bytes)`;
  return {
    type: 'result',
    isError: false,
    ...(isPlainObject(result.value) ? { structuredContent: result.value } : {}),
    text: bounded(text),
  };
}

function genericText(error: TaalcutError): string {
  const again = error.retryable ? ' Trying again later may work.' : '';
  return `Taalcut couldn't do that (${error.code}).${again}`;
}

export function errorItem(error: TaalcutError): ResultItem {
  return {
    type: 'result',
    isError: true,
    structuredContent: {
      error: {
        code: error.code,
        retryable: error.retryable,
        ...(error.params ? { params: { ...error.params } } : {}),
        ...(error.fix ? { fix: error.fix.labelKey } : {}),
      },
    },
    text: mcpErrorText(error) ?? genericText(error),
  };
}

export function pendingItem(approvalId: string): ResultItem {
  return {
    type: 'result',
    isError: true,
    structuredContent: { status: 'awaiting-approval', approvalId },
    text: mcpErrorText(McpAwaitingApproval({ approvalId })) ?? '',
  };
}

export function declinedItem(): ResultItem {
  return {
    type: 'result',
    isError: true,
    structuredContent: { status: 'declined' },
    text: mcpErrorText(McpDeclined()) ?? '',
  };
}
