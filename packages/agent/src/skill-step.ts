// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A skill step (SPEC section 11): route (input built and checked, cost
 * estimated and held to the project cap, then skill.entered and the
 * subset's best tools loaded) and verify (the skill's second method, then
 * the handoff, its card and the flow's follow-ups). The act phase is the
 * ordinary model turn with the skill's prompt and tools (turn-context.ts).
 */
import {
  newId,
  ok,
  type AnySkill,
  type AsyncResult,
  type SkillVerdict,
  type TaalcutError,
} from '@taalcut/core';
import { z } from 'zod';
import type { RunContext } from './context';
import {
  cheaperChoices,
  checkProjectCap,
  DEFAULT_EXPECTED_TURNS,
  mergeLines,
  modelTurnsLine,
  paidModuleOf,
  pauseAtCap,
  toolLine,
} from './costs';
import { SkillInputInvalid, SkillNotFound, VerifyFailed } from './errors';
import { afterHandoff } from './flow-followups';
import { extendAgain, extendFlow, extensionCards, extensionInput, settleExtensionStep } from './flows/extend';
import { stepSuppliedInput } from './flows';
import { emitHandoffTelemetry } from './flow-telemetry';
import { withCommentsAnswered } from './comments/comment-run';
import { commentStepTools } from './comments/comment-request';
import { DESIGNER_SKILL } from './design-jobs';
import { buildMessages } from './messages';
import type { EventInput } from './run-log';
import type { StepState } from './run-state';
import { failedStepCardEvents, handoffCard, plainStepCard, skillContext, stepRef } from './skill-cards';
import { skillSystemPrompt } from './skill-prompt';
import { EDITOR_SKILL, editorStepInput, replacedByChanges } from './editor/editor-turn';
import { withheldTools } from './skill-withheld';
import { offeredWhole, routeWindow } from './skill-offer';
import { fixTools, queryTools, routeQuery } from './route-query';
import { failStepEvents, handoffPayload, settleEvents } from './step-settle';
import { toolOffer } from './tool-offer';

export { settleEvents };

export function subsetCatalogue(ctx: RunContext, skill: AnySkill, withheld: ReadonlySet<string> = new Set()) {
  const names = new Set(ctx.skills.subset(skill).filter((name) => !withheld.has(name)));
  return ctx.registry.catalogue().filter((entry) => names.has(entry.name));
}

/** The subset's best matches for the step: the tools loaded when it starts. */
export function searchSubset(
  ctx: RunContext,
  skill: AnySkill,
  query: string,
  limit: number,
  withheld: ReadonlySet<string> = new Set(),
): string[] {
  const allowed = new Set(ctx.skills.subset(skill).filter((name) => !withheld.has(name)));
  return ctx.registry
    .search(query, { limit: Math.max(limit * 4, 20) })
    .map((hit) => hit.name)
    .filter((name) => allowed.has(name))
    .slice(0, limit);
}

/**
 * A step offered all its tools: the ones it names, in their order, then the rest of its subset (its families'),
 * less what it withholds.
 */
export function wholeOffer(ctx: RunContext, skill: AnySkill, withheld: ReadonlySet<string>): string[] {
  const subset = ctx.skills.subset(skill).filter((name) => !withheld.has(name));
  const named = (skill.tools.names ?? []).filter((name) => subset.includes(name));
  return [...new Set([...named, ...subset])];
}

/**
 * A step that searches: its subset's best `limit` for the query, after each tool its fixes name (AGT2,
 * route-query.ts) and, within the limit, each its query names (the Maker's description names its loop). FIX-CMT: a comment batch's step (no text of its own) also loads the edit tools of what the
 * comments are on first, keeps the other kind's words tool out, and always loads timeline.get and the reply.
 */
function searchedOffer(
  ctx: RunContext,
  step: StepState,
  skill: AnySkill,
  input: unknown,
  query: string,
  limit: number,
  withheld: ReadonlySet<string>,
): string[] {
  const usable = (name: string) => ctx.skills.allows(skill, name) && !withheld.has(name);
  const always = commentStepTools(ctx.log.state, step);
  const named = queryTools(query).filter(usable).slice(0, limit);
  const keptOut = new Set([...withheld, ...always.keptOut, ...named]);
  return [
    ...new Set([
      ...fixTools(input).filter(usable),
      ...always.first.filter(usable),
      ...named,
      ...searchSubset(ctx, skill, query, limit - named.length, keptOut),
      ...always.last.filter(usable),
    ]),
  ];
}

export async function startSkillStep(ctx: RunContext, index: number): AsyncResult<unknown> {
  // Flow extensions anchored here are asked first (SPEC section 25); a step that joins runs before this one.
  const extended = (await extendFlow(ctx, index)) ?? (await extendAgain(ctx, index));
  if (extended) return extended;
  const { log } = ctx;
  const state = log.state;
  const step = state.plan![index]!;
  const started: EventInput = ['step.started', { stepId: step.id, index, text: step.text }];
  const skill = ctx.skills.get(step.skill ?? '');
  if (!skill)
    return log.append(started, ['run.failed', { error: SkillNotFound({ skill: step.skill ?? '' }) }]);
  const supplied = stepSuppliedInput(state, step, step.flow ? extensionInput(ctx, step) : {});
  const parsed = skill.input.safeParse(
    skill.id === EDITOR_SKILL && !step.flow ? editorStepInput(state, supplied) : supplied,
  );
  if (!parsed.success) {
    const error = SkillInputInvalid(
      { skill: skill.id, stepId: step.id },
      { detail: z.prettifyError(parsed.error) },
    );
    return log.append(started, ['run.failed', { error }]);
  }
  const input = parsed.data as unknown;
  const projectId = state.flow?.projectId ?? state.started?.projectId;
  const estimate = ctx.phase2.replay ? undefined : await estimateStep(ctx, step, skill, input);
  const events: EventInput[] = [];
  if (estimate && estimate.usd > 0) {
    const cap = await checkProjectCap(ctx.phase2, projectId, estimate.usd);
    if (cap.over && projectId) {
      return pauseAtCap(log, {
        toolCallIds: [],
        projectId,
        labelKey: skill.labelKey,
        reason: `${skill.id} would go over the project's cap`,
        estimate: { usd: estimate.usd, tokens: estimate.tokens },
        cap: cap.cap,
        // The skill's model turns on another model that fits what is left (paid tools cost the same anywhere).
        cheaper: cheaperChoices(
          ctx.phase2.prices,
          skill.module ?? 'agent',
          estimate.turnTokens,
          cap.cap.usd - cap.cap.spentUsd - (estimate.usd - estimate.turnUsd),
        ),
      });
    }
    events.push([
      'estimate.recorded',
      {
        estimateId: newId<'Estimate'>(),
        stepId: step.id,
        labelKey: skill.labelKey,
        skill: skill.id,
        estimate: { usd: estimate.usd, tokens: estimate.tokens },
        lines: estimate.lines,
        ...(cap.cap ? { cap: cap.cap } : {}),
      },
    ]);
  }
  // FIX-CMT: a comment batch's step (no text of its own) is found by the comments' words alone, with the edit tools
  // of what they are on first, the other kind's words tool kept out, and timeline.get and the reply always.
  const query = routeQuery(state, step, skill, input);
  const withheld = withheldTools(skill, input);
  // AGT2: the offer is sized by the step's models' window (tool-offer.ts) and logged with it.
  const window = routeWindow(ctx, skill.module ?? 'agent');
  const offer = toolOffer(window);
  const tools = offeredWhole(skill, offer)
    ? wholeOffer(ctx, skill, withheld)
    : searchedOffer(ctx, step, skill, input, query, offer.search, withheld);
  const appended = await log.append(
    started,
    ['skill.entered', { stepId: step.id, skill: skill.id, version: skill.version, input }],
    ['route.chosen', { stepId: step.id, query, tools, ...(window !== undefined ? { window } : {}) }],
    ...events,
  );
  if (!appended.ok || ctx.phase2.replay || skill.card || !step.flow) return appended;
  // A step with no card of its own shows a plain step card while it runs.
  const ref = stepRef(log.state, step, 'running');
  const card = ref ? plainStepCard(log.state, step, ref) : undefined;
  return card ? log.append(['card.sent', { card, stepId: step.id }]) : appended;
}

async function estimateStep(ctx: RunContext, step: StepState, skill: AnySkill, input: unknown) {
  const state = ctx.log.state;
  const whole = offeredWhole(skill, toolOffer(ctx.contextWindow?.(skill.module ?? 'agent')));
  const promptChars =
    skillSystemPrompt(ctx.soul, skill, subsetCatalogue(ctx, skill), whole).length +
    JSON.stringify(buildMessages(state, ctx.registry)).length;
  const module = skill.module ?? 'agent';
  const expectedTurns = skill.limits?.expectedTurns ?? DEFAULT_EXPECTED_TURNS;
  const turns = modelTurnsLine(
    ctx.phase2.prices,
    module,
    expectedTurns,
    promptChars,
    ctx.settings.expectedOutputTokens,
  );
  const turnTokens = {
    inputTokens: expectedTurns * Math.ceil(promptChars / 4),
    outputTokens: expectedTurns * ctx.settings.expectedOutputTokens,
  };
  const lines = turns ? [turns] : [];
  if (skill.estimate) {
    try {
      const tools = await skill.estimate(input as never, skillContext(ctx, step));
      if (tools.ok && tools.value.usd > 0) {
        const paid = paidModuleOf(
          skill,
          ctx.skills.subset(skill),
          (t) => ctx.registry.describe(t)?.permission.cloudModules,
        );
        lines.push(toolLine(ctx.phase2.prices, paid, tools.value));
      }
    } catch {
      // A broken estimate is no estimate: the cap still holds at every paid model call.
    }
  }
  return { ...mergeLines(lines), turnTokens, turnUsd: turns?.usd ?? 0 };
}

async function runCheck(
  ctx: RunContext,
  step: StepState,
  skill: AnySkill,
  output: unknown = step.handoff,
): Promise<SkillVerdict> {
  const replayed = ctx.phase2.replay;
  if (replayed) return replayed.nextVerdict() ?? { verdict: 'pass' };
  if (!skill.verify) return { verdict: 'pass' };
  try {
    // Both were parsed by the skill's schemas: the input when the step began (skill.entered), the handoff on handOff.
    const input = step.entered?.input as never;
    const verdict = await skill.verify(output as never, { ...skillContext(ctx, step), input });
    if (verdict.ok) return verdict.value;
    return { verdict: 'retry', reason: `The check could not run (${verdict.error.code}). Hand off again.` };
  } catch (cause) {
    return {
      verdict: 'retry',
      reason: `The check could not run (${String(cause).slice(0, 200)}). Hand off again.`,
    };
  }
}

/** The second method, then the handoff (pass), another try (retry) or the end of the run (fail). */
export async function verifySkillStep(ctx: RunContext, step: StepState): AsyncResult<unknown> {
  const { log } = ctx;
  const skill = ctx.skills.get(step.skill ?? '');
  if (!skill) return log.append(['run.failed', { error: SkillNotFound({ skill: step.skill ?? '' }) }]);
  // EDT1-CMT: a comment batch's handoff answers every comment (comments/comment-run.ts).
  const canRetry = step.verifyRetries < ctx.settings.maxVerifyRetries;
  const verdict = withCommentsAnswered(
    log.state,
    await runCheck(ctx, step, skill),
    canRetry,
    step,
    ctx.skills.get(DESIGNER_SKILL) !== undefined,
  );
  const settle = settleEvents(ctx, step);
  const reason = verdict.verdict === 'pass' ? undefined : verdict.reason;
  const verified: EventInput = [
    'skill.verified',
    { stepId: step.id, verdict: verdict.verdict, ...(reason ? { reason } : {}) },
  ];
  if (verdict.verdict === 'retry' && step.verifyRetries < ctx.settings.maxVerifyRetries) {
    return log.append(verified, [
      'verify.result',
      { stepId: step.id, verdict: 'retry', reason: reason ?? '' },
    ]);
  }
  if (verdict.verdict === 'pass') return acceptHandoff(ctx, step, skill, step.handoff, [verified]);
  const accepted = await settledHandoff(ctx, step, skill);
  if (accepted === undefined)
    return log.append(
      verified,
      ['verify.result', { stepId: step.id, verdict: 'fail', ...(reason ? { reason } : {}) }],
      ...settle,
      ...failedStepCardEvents(log.state, step, Boolean(ctx.phase2.replay)),
      ['run.failed', { error: VerifyFailed({ stepId: step.id }, reason ? { detail: reason } : undefined) }],
    );
  return acceptHandoff(ctx, step, skill, accepted, [verified], true);
}

/**
 * BRK1-MAKE: a skill step that has to end without a handoff: at its turn limit, or after its model answered in words
 * turn after turn (the text loop). On the owner's path the gaps step spent its ten turns on fills that couldn't run
 * and a text answer after its retry, and the run failed with agent.turn_limit. A step its extension can settle is
 * settled from what is stored, as after its last retry; any other step fails the run with `error`.
 */
export async function settleStepOrFail(
  ctx: RunContext,
  step: StepState,
  error: TaalcutError,
): AsyncResult<unknown> {
  const skill = ctx.skills.get(step.skill ?? '');
  const accepted = skill ? await settledHandoff(ctx, step, skill) : undefined;
  if (!skill || accepted === undefined)
    return ctx.log.append(...failStepEvents(ctx, step), ['run.failed', { error }]);
  return acceptHandoff(ctx, step, skill, accepted, [], true);
}

/** The handoff accepted: logged after `before`, then the flow's next steps and the cards. */
async function acceptHandoff(
  ctx: RunContext,
  step: StepState,
  skill: AnySkill,
  output: unknown,
  before: EventInput[],
  settled = false,
): AsyncResult<unknown> {
  const { log } = ctx;
  const settle = settleEvents(ctx, step);
  const handedOff = await handoffPayload(ctx, step, skill, output, settled);
  const appended = await log.append(
    ...before,
    ...(settled ? [['skill.verified', { stepId: step.id, verdict: 'pass' }] as EventInput] : []),
    ['skill.handedOff', handedOff],
    ['verify.result', { stepId: step.id, verdict: 'pass' }],
    ['checkpoint.saved', { stepId: step.id }],
    ...settle,
    ...afterHandoff(log.state, step, output, ctx.skills, ctx.phase2.maxFixLoops),
  );
  if (!appended.ok || ctx.phase2.replay) return appended;
  emitHandoffTelemetry(ctx, step, output);
  const made = await handoffCard(ctx, step, skill, output);
  // EDT1: in a docked run the changes card, at the end, stands for the Editor's timeline card.
  const card = made && !replacedByChanges(log.state, made) ? made : undefined;
  const cards: EventInput[] = [
    ...(card ? [['card.sent', { card, stepId: step.id }] as EventInput] : []),
    ...extensionCards(ctx, step, output),
  ];
  return cards.length > 0 ? log.append(...cards) : ok(undefined);
}

/**
 * BRK1-MAKE: an extension step whose model never passed the check, settled from what is stored when its extension
 * can and the skill's check passes that; undefined, and the run fails as before.
 */
async function settledHandoff(ctx: RunContext, step: StepState, skill: AnySkill): Promise<unknown> {
  const found = await settleExtensionStep(ctx, step);
  if (found === undefined) return undefined;
  const parsed = skill.output.safeParse(found);
  if (!parsed.success) return undefined;
  const verdict = await runCheck(ctx, step, skill, parsed.data);
  return verdict.verdict === 'pass' ? parsed.data : undefined;
}
