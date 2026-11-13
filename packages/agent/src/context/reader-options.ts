// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The reader uses the same window and response reservation as prompt fitting. */
import type { ModuleId } from '@taalcut/models';
import type { RunContext } from '../context';
import { ANSWER_TOKENS, promptBudget } from './compaction';
import { loggedResult } from './result-references';

export function readerOptions(ctx: RunContext, module: ModuleId) {
  const window = ctx.contextWindow?.(module) ?? ctx.log.state.plan?.[ctx.log.state.stepIndex]?.window;
  const reserve = Math.max(ctx.settings.maxOutputTokens ?? ANSWER_TOKENS, ANSWER_TOKENS);
  return {
    loggedResult: (id: string) => loggedResult(ctx.log.state, id),
    ...(window ? { pageTokens: Math.max(128, Math.floor(promptBudget(window, reserve) / 8)) } : {}),
  };
}
