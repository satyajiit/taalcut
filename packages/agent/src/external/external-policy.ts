// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What an external run (P3-V4) adds to the agent's own policy: the session's level (read: reads only; edit:
 * no export or external tools; export: everything), Local only as it is now (a session outlives a change of
 * the switch), and approval cards that say which external agent asked (`approvalCardSchema.requester`). A tool
 * with its own decision card (render.export's exportApproval) keeps it.
 */
import { ok, type AnyTool, type CardOf, type McpLevel, type RunId } from '@taalcut/core';
import type { ToolDescriptor, ToolGateRequest, ToolPolicy } from '@taalcut/tools';
import { localOnlyRefusal } from '../local-only/local-only';
import type { McpRequester } from './external-types';

/** Does the session's level cover the tool? */
export function levelAllows(
  level: McpLevel,
  tool: Pick<ToolDescriptor, 'sideEffect' | 'checkpoint'>,
): boolean {
  if (level === 'export') return true;
  if (tool.checkpoint || tool.sideEffect === 'external') return false;
  return level === 'edit' || tool.sideEffect === 'read';
}

/**
 * Refuses what Local only refuses while it is on now (the agent's rule: a cloud-module tool runs only when its
 * modules run on this Mac, `onDevice`), then asks the agent's policy.
 */
export function withLocalOnlyNow(
  policy: ToolPolicy,
  localOnly: (() => boolean) | undefined,
  onDevice?: (module: string) => boolean,
): ToolPolicy {
  if (!localOnly) return policy;
  return {
    ...policy,
    checkPermission(request: ToolGateRequest) {
      const refused = localOnly() ? localOnlyRefusal(request.tool.permission, onDevice) : undefined;
      if (refused) return { kind: 'deny', reason: refused };
      return policy.checkPermission?.(request) ?? { kind: 'allow' };
    },
  };
}

const DETAILS_LIMIT = 600;

/**
 * The tool's spec with an approval card naming the external agent that asked. The summary is the tool's own
 * one-liner (no model wrote one); the details are its input, cut short.
 */
export function withRequesterCard(
  spec: AnyTool | undefined,
  requesterOf: (runId: RunId) => McpRequester | undefined,
): AnyTool | undefined {
  if (!spec || spec.approvalCard) return spec;
  return {
    ...spec,
    async approvalCard(input, ctx) {
      const requester = requesterOf(ctx.runId);
      const card: CardOf<'approval'> = {
        type: 'approval',
        id: ctx.approvalId,
        version: 1,
        runId: ctx.runId,
        approvalId: ctx.approvalId,
        tool: spec.name,
        sideEffect: spec.sideEffect === 'read' ? 'write' : spec.sideEffect,
        summary: spec.summary ?? firstSentence(spec.description),
        details: (JSON.stringify(input) ?? '').slice(0, DETAILS_LIMIT),
        status: 'pending',
        ...(requester
          ? { requester: { kind: 'mcp', sessionId: requester.sessionId, name: requester.name.slice(0, 60) } }
          : {}),
      };
      return ok(card);
    },
  };
}

function firstSentence(text: string): string {
  const end = text.search(/[.!?](\s|$)/);
  return end >= 0 ? text.slice(0, end + 1) : text;
}
