// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A scripted model that works through a flow the way a capable model would:
 * it reads which skill it is running from the system prompt (`# Skill: <id>`)
 * and its input from the skill input note, calls the skill's tools and hands
 * off what they returned. Decisions come from the request alone, so a run
 * resumed in another agent gets the same answers.
 */
import { CONTROL_PREFIX, SKILL_INPUT_NOTE, type ModelScript, type ScriptedReply } from '@taalcut/agent';
import type { ChatMessage, ModelRequest } from '@taalcut/models';
import { call } from './harness';

export interface FlowScriptOptions {
  /** The plan turn calls startFlow with this (absent: the run started from an opening card, or answers in text). */
  readonly startFlow?: Record<string, unknown>;
  /** The Librarian asks how many variants (default true). */
  readonly ask?: boolean;
  /** Variants when the Librarian doesn't ask (the user said, or autopilot). */
  readonly variants?: number;
  /** The Librarian reranks this many slots with the paid vision tool. */
  readonly rerank?: number;
  /** Each model turn's price (US$). */
  readonly turnUsd?: number;
  /** Reply on the main model's act turns (a follow-up message). */
  readonly reply?: (request: ModelRequest) => ScriptedReply;
}

export const text = (m: ChatMessage | undefined) =>
  m && 'content' in m && typeof m.content === 'string' ? m.content : '';

/** A control note's JSON (before any fenced untrusted part), or {}. */
export function json(content: string): Record<string, unknown> {
  try {
    return JSON.parse(content.split('\n\n<untrusted')[0] ?? '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** The skill's input and how many turns it has taken so far. */
export function skillTurn(request: ModelRequest) {
  const marker = `${CONTROL_PREFIX} ${SKILL_INPUT_NOTE}`;
  const at = request.messages.findLastIndex((m) => m.role === 'user' && text(m).startsWith(marker));
  const input = at >= 0 ? json(text(request.messages[at]).slice(marker.length).trim()) : {};
  const after = request.messages.slice(at + 1);
  const turn = after.filter((m) => m.role === 'assistant').length;
  const tools = after.filter((m) => m.role === 'tool');
  const last = tools.at(-1);
  // The user's own number of versions ("make 3 versions"), which the Librarian passes on instead of asking.
  const said = /(\d+) (?:versions|variants)/.exec(text(request.messages.find((m) => m.role === 'user')))?.[1];
  return {
    input,
    turn,
    said: said ? Number(said) : undefined,
    result: json(text(last)),
    lastText: text(last),
    results: tools.map((m) => json(text(m))),
  };
}

export function flowScript(options: FlowScriptOptions = {}): ModelScript {
  const usage = { usage: { costUsd: options.turnUsd ?? 0 } };
  return (request, turn) => {
    const skill = /# Skill: (\S+)/.exec(request.system ?? '')?.[1];
    if (!skill) {
      const offersFlow = request.tools?.some((t) => t.name === 'startFlow');
      if (offersFlow && options.startFlow && turn === 0)
        return { toolCalls: [call('startFlow', options.startFlow)], ...usage };
      return options.reply?.(request) ?? { text: 'Done.', ...usage };
    }
    const at = skillTurn(request);
    const reply = (r: ScriptedReply): ScriptedReply => ({ ...r, ...usage });
    switch (skill) {
      case 'templates.analyst':
        if (at.turn === 0)
          return reply({ toolCalls: [call('templates_breakdown', { reference: at.input.reference })] });
        return reply({
          toolCalls: [
            call('handOff', {
              ...pick(at.result, ['templateId', 'version', 'slotCount']),
              unconfirmedCuts: [],
            }),
          ],
        });
      case 'timeline.librarian':
        return reply(librarian(at, options));
      case 'timeline.editor':
        if (at.turn === 0)
          return reply({ toolCalls: [call('timeline_trimClip', { timelineId: at.input.timelineId })] });
        return reply({ toolCalls: [call('handOff', pick(at.result, ['timelineId', 'revision']))] });
      case 'render.reviewer': {
        if (at.turn === 0)
          return reply({ toolCalls: [call('render_review', { timelineId: at.input.timelineId })] });
        const passed = at.result.passed === true;
        const fixes = passed ? [] : [{ checkId: 'blackFrames', action: 'swap' }];
        return reply({
          toolCalls: [
            call('handOff', {
              renderId: at.result.renderId,
              timelineRevision: at.input.timelineRevision,
              passed,
              fixes,
            }),
          ],
        });
      }
      case 'agent.brief':
        if (at.turn === 0) return reply({ toolCalls: [call('library_listSources', {})] });
        return reply({
          toolCalls: [call('handOff', { text: 'A 30 s reel of the Goa trip, upbeat.', targetSeconds: 30 })],
        });
      default:
        return reply({ text: `No script for ${skill}.` });
    }
  };
}

function librarian(at: ReturnType<typeof skillTurn>, options: FlowScriptOptions): ScriptedReply {
  const ask = (options.ask ?? true) && at.said === undefined;
  const steps: ScriptedReply[] = [];
  if (ask) steps.push({ toolCalls: [call('askUser', { question: 'variants', suggested: 2, slotCount: 4 })] });
  const answered = /chose (\d+)|go with (\d+)/.exec(at.lastText);
  const variants = Number(answered?.[1] ?? answered?.[2] ?? at.said ?? options.variants ?? 1);
  const target = at.input.templateId
    ? { templateId: at.input.templateId }
    : { brief: (at.input.brief as { text?: string })?.text };
  steps.push({ toolCalls: [call('timeline_cast', { ...target, variants })] });
  if (options.rerank) steps.push({ toolCalls: [call('timeline_rerank', { slots: options.rerank })] });
  if (at.turn < steps.length) return steps[at.turn]!;
  // The cast is the tool result with timelineIds (a rerank may have come after it).
  const cast = at.results.findLast((r) => Array.isArray(r.timelineIds)) ?? {};
  return {
    toolCalls: [
      call(
        'handOff',
        pick(cast, ['timelineIds', 'revisions', 'templateId', 'lowConfidenceSlots', 'reranked']),
      ),
    ],
  };
}

const pick = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(keys.filter((k) => value[k] !== undefined).map((k) => [k, value[k]]));
