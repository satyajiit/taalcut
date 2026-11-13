// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT1: a model turn's messages, condensed to fit the window of the model that answers it (compaction.ts). The
 * window is read for each call (`RunContext.contextWindow`, the smallest in the module's chain); replay reads the
 * logged one. Without a window, or under the budget, the messages are buildMessages' own.
 */
import type { TaalcutError } from '@taalcut/core';
import { ModelContextTooLong, type ChatMessage, type ToolSpec } from '@taalcut/models';
import type { RunContext } from '../context';
import { buildPromptBlocks } from '../messages';
import type { EventInput } from '../run-log';
import { turnContext, type TurnContext } from '../turn-context';
import { ANSWER_TOKENS, compactPrompt, estimateTokens, promptBudget, type Compacted } from './compaction';
import { finishingTools, prioritisedTools } from './tool-priority';
import { selectedOffer, wasSelectedOffer } from './selected-offer';

interface FittedPrompt {
  readonly turn: TurnContext;
  readonly messages: ChatMessage[];
  readonly compacted?: EventInput;
  readonly error?: TaalcutError;
}

export function fitPrompt(
  ctx: RunContext,
  turn: TurnContext,
  modelCallId: string,
  phase: 'plan' | 'act' = 'act',
): FittedPrompt {
  const state = ctx.log.state;
  const blocks = buildPromptBlocks(state, ctx.registry);
  // A preflight failure has no model.requested to replay. Its route still records the step's window.
  const window = ctx.contextWindow?.(turn.module) ?? state.plan?.[state.stepIndex]?.window;
  const whole = () => blocks.flatMap((block) => block.messages);
  if (!window) return { turn, messages: whole() };
  // The provider adapter also reserves answer space. A smaller requested response must not let the prompt
  // consume that space and turn even a 512-token request into a one-token request on the wire.
  const budget = promptBudget(window, Math.max(ctx.settings.maxOutputTokens ?? ANSWER_TOKENS, ANSWER_TOKENS));
  let unreadReferences = false;
  const fit = (candidate: TurnContext): Compacted => {
    const compacted = compactPrompt({
      blocks,
      state,
      system: candidate.system,
      tools: candidate.tools,
      budget,
      unreadReferences,
    });
    if (compacted) return compacted;
    const messages = whole();
    const tokens = estimateTokens(candidate.system, candidate.tools, messages);
    return {
      messages,
      beforeTokens: tokens,
      afterTokens: tokens,
      condensedResults: 0,
      droppedTurns: 0,
      summarisedSteps: 0,
      fits: true,
    };
  };
  const compacted = fit(turn);
  if (compacted.fits && compacted.beforeTokens <= budget) return { turn, messages: compacted.messages };
  const beforeTokens = compacted.beforeTokens;
  let fitted = compacted.fits ? { turn, compacted } : fitToolOffer(ctx, turn, phase, fit);
  // Optional schemas must not displace a readable answer. Exact readback remains the fallback when even
  // the relevant minimum offer cannot carry that answer, including a new cast or a large timeline.
  if (!fitted.compacted.fits) {
    unreadReferences = true;
    const referenced = fit(turn);
    fitted = referenced.fits ? { turn, compacted: referenced } : fitToolOffer(ctx, turn, phase, fit);
  }
  // The tool the step has to call next is not optional. When the offer left it out, lead with it if that fits as
  // it stands: no result the first offer kept readable is hidden. A tool the model has just searched for comes
  // first all the same.
  const finishing = fitted.turn === turn ? [] : finishingTools(ctx);
  const next = finishing[0]?.name;
  const offers = (candidate: TurnContext) => candidate.tools.some((tool) => tool.name === next);
  if (next && !offers(fitted.turn) && !prioritisedTools(ctx, turn.tools).freshSelection) {
    const led = fitToolOffer(ctx, turn, phase, fit, finishing);
    if (led.compacted.fits && offers(led.turn)) fitted = led;
  }
  const { messages, ...counts } = fitted.compacted;
  return {
    turn: fitted.turn,
    messages,
    compacted: ['context.compacted', { modelCallId, window, budgetTokens: budget, ...counts, beforeTokens }],
    ...(!counts.fits
      ? {
          error: ModelContextTooLong(undefined, {
            detail: `The required prompt and tool schema need ${counts.afterTokens} estimated tokens; the ${window}-token window permits ${budget}.`,
          }),
        }
      : {}),
  };
}

/** Keep the most relevant schema first, then add only schemas that leave the prompt within its budget. */
function fitToolOffer(
  ctx: RunContext,
  turn: TurnContext,
  phase: 'plan' | 'act',
  fit: (candidate: TurnContext) => Compacted,
  finishing: readonly ToolSpec[] = [],
) {
  const { meta, domain, freshSelection } = prioritisedTools(ctx, turn.tools, finishing);
  const kept = [...meta];
  // The first tool is the latest explicit findTools choice, otherwise the route's best match. If even that
  // schema cannot fit, do not silently replace it with a cheaper, unrelated tool or send a one-token request.
  if (domain[0]) kept.push(domain[0]);
  let fittedTurn = turnContext(ctx, phase, { tools: kept });
  let compacted = fit(fittedTurn);
  if (!compacted.fits) {
    if (freshSelection && domain[0]) {
      const selected = selectedOffer(
        turnContext(ctx, phase, {
          tools: [...meta.filter((tool) => tool.name === 'findTools'), domain[0]],
        }),
        meta,
      );
      const result = fit(selected);
      if (result.fits) return { turn: selected, compacted: result };
    }
    // After reading data or completing the chosen tool, meta tools can inspect its result or hand off.
    // A fresh findTools response still requires its chosen schema on the next turn.
    const latest = ctx.log.state.transcript.findLast((item) => item.kind === 'assistant');
    const reading = latest?.toolCallIds.some(
      (id) =>
        ctx.log.state.toolCalls[id]?.requested.tool === 'readArtifact' &&
        ctx.log.state.toolCalls[id]?.outcome?.kind === 'completed',
    );
    const searched = latest?.toolCallIds.some(
      (id) =>
        ctx.log.state.toolCalls[id]?.requested.tool === 'findTools' &&
        ctx.log.state.toolCalls[id]?.outcome?.kind === 'completed',
    );
    const completedChoice = latest?.toolCallIds.some((id) => {
      const call = ctx.log.state.toolCalls[id];
      return (
        !call?.requested.meta &&
        call?.requested.callName === domain[0]?.name &&
        call?.outcome?.kind === 'completed'
      );
    });
    const changed = ctx.log.state.inputChanges.some((change) => !change.applied);
    if ((reading || completedChoice || wasSelectedOffer(ctx)) && (!searched || changed)) {
      const reader = turnContext(ctx, phase, { tools: meta });
      const result = fit(reader);
      if (result.fits) return { turn: reader, compacted: result };
    }
    return { turn: fittedTurn, compacted };
  }
  for (const tool of domain.slice(1)) {
    const candidate = turnContext(ctx, phase, { tools: [...kept, tool] });
    const result = fit(candidate);
    if (!result.fits) continue;
    kept.push(tool);
    fittedTurn = candidate;
    compacted = result;
  }
  return { turn: fittedTurn, compacted };
}
