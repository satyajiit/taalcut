// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A scripted model for flows with the Phase 3 steps: the flow script's skills, plus `agent.gaps` (applies the
 * fix its input gives each gap with the stand-in tools, then hands off what it did) and `voice.director`
 * (hands off at once). Decisions come from the request alone, like the flow script's.
 */
import { CONTROL_PREFIX, SKILL_INPUT_NOTE, type ModelScript, type ScriptedReply } from '@taalcut/agent';
import type { ModelRequest } from '@taalcut/models';
import { flowScript, json, text, type FlowScriptOptions } from '../support/flow-script';
import { call } from '../support/harness';

interface GapInput {
  readonly timelineId: string;
  readonly gapId: string;
  readonly slotId: string | null;
  readonly state: 'empty' | 'weak';
  readonly fixes: string[];
  readonly fix: string;
  readonly prompt?: string;
  readonly query?: string;
  readonly swapTo?: { readonly assetId: string; readonly shotId: string | null };
  readonly borrow?: { readonly clipId: string; readonly instead: { assetId: string; shotId: string | null } };
  readonly sourceStart?: unknown;
}

/** FIX-ASK: the clip a gap takes, as its tool takes it: a swap for an unsure clip, a fill for an empty shot. */
function take(g: GapInput, media: { assetId: string; shotId: string | null }, sourceStart?: unknown) {
  const start = sourceStart === undefined ? {} : { sourceStart };
  return g.state === 'weak'
    ? call('timeline_swapClip', { timelineId: g.timelineId, clipId: g.gapId, media, ...start, from: 'agent' })
    : call('timeline_fillGap', {
        timelineId: g.timelineId,
        gapId: g.gapId,
        media: { kind: 'video', ...media, ...start },
      });
}

function skillTurn(request: ModelRequest) {
  const marker = `${CONTROL_PREFIX} ${SKILL_INPUT_NOTE}`;
  const at = request.messages.findLastIndex((m) => m.role === 'user' && text(m).startsWith(marker));
  const input = at >= 0 ? json(text(request.messages[at]).slice(marker.length).trim()) : {};
  const after = request.messages.slice(at + 1);
  return {
    input,
    turn: after.filter((m) => m.role === 'assistant').length,
    results: after.filter((m) => m.role === 'tool').map((m) => json(text(m))),
  };
}

/** The tool calls that apply each gap's fix. */
function fixCalls(projectId: unknown, gaps: readonly GapInput[]) {
  return gaps.flatMap((g) => {
    switch (g.fix) {
      case 'drop':
        return [call('timeline_dropSlot', { timelineId: g.timelineId, itemId: g.gapId })];
      case 'generate':
        return [
          call('images_generateForSlot', {
            projectId,
            timelineId: g.timelineId,
            slotId: g.slotId,
            prompt: g.prompt,
          }),
        ];
      case 'stock':
        return [
          call('stock_search', { query: g.query }),
          call('timeline_fillGap', { timelineId: g.timelineId, gapId: g.gapId, assetId: 'pexels-1' }),
        ];
      case 'swap':
        return [
          call('timeline_swapClip', {
            timelineId: g.timelineId,
            clipId: g.gapId,
            media: g.swapTo,
            from: 'agent',
          }),
        ];
      case 'borrow':
        return g.borrow && g.swapTo
          ? [
              call('timeline_swapClip', {
                timelineId: g.timelineId,
                clipId: g.borrow.clipId,
                media: g.borrow.instead,
                from: 'agent',
              }),
              take(g, g.swapTo),
            ]
          : [];
      case 'reuse':
        return g.swapTo ? [take(g, g.swapTo, g.sourceStart)] : [];
      case 'keep':
        return [];
      default:
        return g.state === 'weak' && g.slotId
          ? [call('timeline_markForFilming', { timelineId: g.timelineId, slotIds: [g.slotId] })]
          : [];
    }
  });
}

function gapsTurn(request: ModelRequest): ScriptedReply {
  const at = skillTurn(request);
  const gaps = (Array.isArray(at.input.gaps) ? at.input.gaps : []) as GapInput[];
  const timelineIds = (Array.isArray(at.input.timelineIds) ? at.input.timelineIds : []) as string[];
  const calls = fixCalls(at.input.projectId, gaps);
  if (at.turn === 0 && calls.length > 0) return { toolCalls: calls };
  // Each timeline's revision: the newest a write returned for it, else the Librarian's (1).
  const revisions = new Map<string, number>();
  for (const result of at.results)
    if (typeof result.timelineId === 'string' && typeof result.revision === 'number')
      revisions.set(result.timelineId, Math.max(revisions.get(result.timelineId) ?? 0, result.revision));
  return {
    toolCalls: [
      call('handOff', {
        gaps: gaps.map((g) => ({
          timelineId: g.timelineId,
          gapId: g.gapId,
          slotId: g.slotId,
          fixes: g.fixes,
          applied: g.fix,
        })),
        filming: gaps.filter((g) => g.fix === 'film').length,
        timelines: timelineIds.map((id) => ({ timelineId: id, revision: revisions.get(id) ?? 1 })),
      }),
    ],
  };
}

export function gapFlowScript(options: FlowScriptOptions = {}): ModelScript {
  const base = flowScript(options);
  return (request, turn) => {
    const skill = /# Skill: (\S+)/.exec(request.system ?? '')?.[1];
    if (skill === 'agent.gaps') return gapsTurn(request);
    if (skill === 'voice.director') {
      const at = skillTurn(request);
      return { toolCalls: [call('handOff', { timelineId: at.input.timelineId, lines: 2 })] };
    }
    return base(request, turn);
  };
}
