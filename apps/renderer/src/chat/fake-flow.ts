// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- scripted model output: data, never translated */

/**
 * The fake agent's flows (agent SPEC section 13): an opening choice (or a
 * typed "make a video…") seeds one plan step per skill and runs them, sending
 * every Phase 2 card in order, up to the one approval. The run pauses there;
 * answering it exports (or not). A change the user makes while it waits
 * (a slot edit, a swap) sends the card back to "updating" and asks again under
 * the same card id. With `budget: 'cap'` the casting step stops at the
 * project's cap first. The pages and the end-to-end specs run on this, no models.
 */
import {
  newId,
  type Card,
  type ChatStart,
  type ConversationId,
  type MessageId,
  type OpeningPath,
  type RunId,
} from '@taalcut/core';
import * as cards from './fake-flow-cards';
import { event, stream, type Beat } from './fake-script';

export type FlowBudget = 'cap' | 'none';

interface Ids {
  runId: RunId;
  conversationId: ConversationId;
  messageId: MessageId;
}

type Continue = (decision: 'approve' | 'deny', ids: Ids) => Beat[];

const card = (runId: RunId, payload: Card) => event('agent.card', { runId, card: payload });

/** The brief the library path proposes from the newest clips (the agent's agent.brief skill). */
const LIBRARY_BRIEF =
  'From your newest clips, Goa, 10 to 12 October: a 30 s travel reel, the beach at sunset first and the market last.';

/** Does a typed message ask for a video, so it starts the describe flow? */
export function asksForVideo(text: string): boolean {
  return /\b(make|cut|create|edit)\b.*\b(video|reel|vlog|short)\b/i.test(text);
}

export function createFlowEngine(
  options: {
    budget?: FlowBudget;
    lastCommand?: () => string | undefined;
  } = {},
) {
  const waiting = new Map<string, { ctx: cards.FlowContext; resume: Continue }>();
  /** Runs paused on the export approval, by run: what a change while waiting re-runs. */
  const atExport = new Map<RunId, { ctx: cards.FlowContext; approvalId: string }>();
  let capAsked = false;

  const step = (runId: RunId, skill: string, status: 'running' | 'done') =>
    ({
      wait: 60,
      event: event('agent.step', { runId, stepId: cards.stepIdOf(skill), status }),
    }) satisfies Beat;
  const show = (ctx: cards.FlowContext, payload: Card, wait = 120): Beat => ({
    wait,
    event: card(ctx.runId, payload),
  });
  const say = (ids: Ids, text: string) => stream(ids, text, 'agent.messageDelta', 30);

  function pauseOnExport(ctx: cards.FlowContext, ids: Ids, lead: string): Beat[] {
    const approvalId = `export:${newId<'Approval'>()}`;
    atExport.set(ctx.runId, { ctx, approvalId });
    waiting.set(approvalId, {
      ctx,
      resume: (decision, next) => exportAnswer(ctx, approvalId, decision, next),
    });
    return [
      step(ctx.runId, 'render.export', 'running'),
      show(ctx, cards.exportApproval(ctx, approvalId, 'pending')),
      ...say(ids, lead),
      { wait: 60, event: event('agent.runFinished', { runId: ctx.runId, status: 'paused' }) },
    ];
  }

  /** Casting to the end: the cast board, the cut, the check, then the one approval. */
  function fromCasting(ctx: cards.FlowContext, ids: Ids, spent: number): Beat[] {
    if (options.budget === 'cap' && !capAsked) {
      capAsked = true;
      const approvalId = `cap:${newId<'Approval'>()}`;
      waiting.set(approvalId, {
        ctx,
        resume: (decision, next) => capAnswer(ctx, approvalId, decision, next),
      });
      return [
        show(ctx, cards.budgetCap(ctx, approvalId, 'pending')),
        ...say(ids, 'Picking your clips would go over this project’s budget, so I stopped here.'),
        { wait: 60, event: event('agent.runFinished', { runId: ctx.runId, status: 'paused' }) },
      ];
    }
    return [
      show(ctx, cards.cost(ctx, 'timeline.librarian', 'going-ahead', 60_000, spent)),
      show(ctx, cards.castBoard(ctx, false), 200),
      show(ctx, cards.castBoard(ctx, true), 700),
      show(ctx, cards.cost(ctx, 'timeline.librarian', 'settled', 60_000, spent), 80),
      step(ctx.runId, 'timeline.librarian', 'done'),
      step(ctx.runId, 'timeline.editor', 'running'),
      show(ctx, cards.timeline(ctx), 700),
      step(ctx.runId, 'timeline.editor', 'done'),
      ...checking(ctx),
      ...pauseOnExport(
        ctx,
        ids,
        'It’s cut and checked: 18 of 19 checks passed. Export it when you’re ready.',
      ),
    ];
  }

  function checking(ctx: cards.FlowContext): Beat[] {
    return [
      step(ctx.runId, 'render.reviewer', 'running'),
      show(ctx, cards.draft(ctx, false), 200),
      show(ctx, cards.draft(ctx, true), 700),
      show(ctx, cards.qaReport(ctx), 120),
      step(ctx.runId, 'render.reviewer', 'done'),
    ];
  }

  function exportAnswer(ctx: cards.FlowContext, approvalId: string, decision: 'approve' | 'deny', ids: Ids) {
    atExport.delete(ctx.runId);
    const started = {
      wait: 0,
      event: event('agent.runStarted', { runId: ctx.runId, conversationId: ids.conversationId }),
    };
    if (decision === 'deny')
      return [
        started,
        show(ctx, cards.exportApproval(ctx, approvalId, 'declined'), 0),
        ...say(ids, 'Okay, not exported. Say when you’re ready, or ask for a change.'),
        { wait: 60, event: event('agent.runFinished', { runId: ctx.runId, status: 'succeeded' }) },
      ];
    return [
      started,
      show(ctx, cards.exportApproval(ctx, approvalId, 'exporting'), 0),
      show(ctx, cards.exported(ctx, false), 200),
      show(ctx, cards.exported(ctx, true), 900),
      show(ctx, cards.exportApproval(ctx, approvalId, 'exported'), 40),
      step(ctx.runId, 'render.export', 'done'),
      ...say(ids, 'Exported for Instagram Reels. It’s in Renders, and the file is in your Movies folder.'),
      show(ctx, cards.anotherOne(ctx), 120),
      { wait: 60, event: event('agent.runFinished', { runId: ctx.runId, status: 'succeeded' }) },
    ];
  }

  function capAnswer(ctx: cards.FlowContext, approvalId: string, decision: 'approve' | 'deny', ids: Ids) {
    const started = {
      wait: 0,
      event: event('agent.runStarted', { runId: ctx.runId, conversationId: ids.conversationId }),
    };
    if (decision === 'deny')
      return [
        started,
        show(ctx, cards.budgetCap(ctx, approvalId, 'stopped'), 0),
        ...say(ids, 'Stopped at your budget. What’s done so far stays.'),
        { wait: 60, event: event('agent.runFinished', { runId: ctx.runId, status: 'cancelled' }) },
      ];
    // The card says how you answered: a raised cap, or a cheaper model (the command you ran first).
    const raised = options.lastCommand?.() !== 'models.setModuleOverride';
    return [
      started,
      show(ctx, cards.budgetCap(ctx, approvalId, raised ? 'raised' : 'switched'), 0),
      ...fromCasting(ctx, ids, 1_920_000),
    ];
  }

  /** The first stretch of a flow, up to its first pause. */
  function start(path: OpeningPath, ids: Ids): Beat[] {
    const ctx: cards.FlowContext = {
      runId: ids.runId,
      flowId: newId<'Flow'>(),
      path,
      renderId: newId<'Render'>(),
      exportRenderId: newId<'Render'>(),
    };
    const first = cards.FLOW_STEPS[path][0]!.skill;
    const head: Beat[] = [
      { wait: 0, event: event('agent.runStarted', { runId: ids.runId, conversationId: ids.conversationId }) },
      { wait: 150, event: event('agent.plan', { runId: ids.runId, steps: cards.plan(ctx, []).steps }) },
      step(ids.runId, first, 'running'),
    ];
    if (path === 'reference') {
      return [
        ...head,
        show(ctx, cards.cost(ctx, 'templates.analyst', 'going-ahead', 120_000, 420_000)),
        show(ctx, cards.breakdown(ctx, 'fetching', 0.1), 200),
        show(ctx, cards.breakdown(ctx, 'cuts', 0.3), 500),
        show(ctx, cards.breakdown(ctx, 'beats', 0.5), 500),
        show(ctx, cards.breakdown(ctx, 'intents', 0.85), 500),
        show(ctx, cards.breakdown(ctx, 'ready', 1), 500),
        show(ctx, cards.cost(ctx, 'templates.analyst', 'settled', 120_000, 420_000), 80),
        step(ids.runId, 'templates.analyst', 'done'),
        step(ids.runId, 'timeline.librarian', 'running'),
        ...fromCasting(ctx, ids, 522_000),
      ];
    }
    // As the agent's flows: a template or a description goes straight to picking clips.
    if (path === 'template' || path === 'describe') return [...head, ...fromCasting(ctx, ids, 420_000)];
    return [
      ...head,
      show(ctx, cards.brief(ctx, 'running')),
      show(ctx, cards.brief(ctx, 'ready', LIBRARY_BRIEF), 700),
      step(ids.runId, 'agent.brief', 'done'),
      step(ids.runId, 'timeline.librarian', 'running'),
      ...fromCasting(ctx, ids, 420_000),
    ];
  }

  return {
    start,
    /** The flow's own answer to one of its cards, if `approvalId` is one. */
    continuation(approvalId: string): Continue | undefined {
      const found = waiting.get(approvalId);
      if (!found) return undefined;
      return (decision, ids) => {
        waiting.delete(approvalId);
        return found.resume(decision, ids);
      };
    },
    /**
     * You changed something the flow made while it waited on the export: the card goes back to
     * "updating", the video is checked again and the approval comes back under the same card id.
     */
    edited(conversationOf: (runId: RunId) => ConversationId | undefined): { runId: RunId; beats: Beat[] }[] {
      return [...atExport.values()].flatMap(({ ctx, approvalId }) => {
        const conversationId = conversationOf(ctx.runId);
        if (!conversationId) return [];
        waiting.delete(approvalId);
        atExport.delete(ctx.runId);
        const ids: Ids = { runId: ctx.runId, conversationId, messageId: newId<'Message'>() };
        return {
          runId: ctx.runId,
          beats: [
            { wait: 0, event: event('agent.runStarted', { runId: ctx.runId, conversationId }) },
            show(ctx, cards.exportApproval(ctx, approvalId, 'updating'), 0),
            ...checking(ctx).map((beat) => (beat.wait > 500 ? { ...beat, wait: 1_500 } : beat)),
            ...pauseOnExport(
              ctx,
              ids,
              'Updated with your change and checked again. Export it when you’re ready.',
            ),
          ],
        };
      });
    },
  };
}

export type FlowEngine = ReturnType<typeof createFlowEngine>;

/** The flow a message starts: its opening choice, or a typed request for a video. */
export function flowFor(text: string, start: ChatStart | undefined): OpeningPath | undefined {
  if (start) return start.path;
  return asksForVideo(text) ? 'describe' : undefined;
}
