// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the stand-in model does in the make flow's journeys, turn by turn and
 * skill by skill, reading ids, frames and revisions from the tool results
 * like a real model would (make-flow-fixtures.ts has the journeys):
 *
 * - main turn: a reel's path starts the `reference` flow, a typed brief the
 *   `describe` flow (startFlow);
 * - Analyst: break the reel down, judge the disputed cuts, then a page of
 *   slots at a time use its local descriptions or look at its frames
 *   and store the page's intents; finalise, hand off;
 * - Librarian: plan from the vlog format for a brief, cast, keep the order of
 *   each slot the cast lists for a rerank, assemble, hand off the revisions
 *   the assembly returned (one variant: the journeys don't ask);
 * - Gaps (after the Librarian when slots are left open): apply each gap's
 *   given fix (make-flow-gaps.ts);
 * - Editor: read the timeline, fill each text item for the user's footage,
 *   hand off its revision;
 * - Reviewer: draft the timeline version, hand off what QA said.
 *
 * A tool the step hasn't loaded is found with findTools first.
 */
import {
  MAKE_FLOW_ASKS,
  MAKE_FLOW_BRIEF,
  MAKE_FLOW_SWAP_REFERENCE,
  REFERENCE_SHOTS,
  REFERENCE_TEMPLATE_NAME,
  referenceIn,
} from './make-flow-fixtures';
import { resultJson, type RequestView, type ToolCall } from './anthropic-view';
import { EDIT_JOURNEY_ASK, EDIT_JOURNEY_REPORT } from './make-flow-edit';
import { commentsTurn, isCommentsAsk } from './make-flow-comments';
import { gapsTurn } from './make-flow-gaps';
import { editorTurn } from './make-flow-editor';
import { writeAnalystPage } from './make-flow-analyst-page';
import { librarianTurn } from './make-flow-librarian';
import {
  call,
  callsTo,
  collectionSize,
  list,
  need,
  readCall,
  record,
  use,
  withReads,
  type Json,
} from './make-flow-reads';
import type { DemoTurn } from './script';
import { carryProgress, resumeProgress } from './make-flow-progress';

/** The frames where the reel's shots change (make-flow-fixtures.ts REFERENCE_SHOTS). */
const SHOT_CHANGES = REFERENCE_SHOTS.slice(0, -1).reduce<number[]>(
  (at, shot) => [...at, (at.at(-1) ?? 0) + shot.frames],
  [],
);

export const isMakeFlowAsk = (ask: string): boolean =>
  MAKE_FLOW_ASKS.some((known) => ask.includes(known)) || ask.includes(EDIT_JOURNEY_ASK);

/** The chat's title after the first exchange (a request without tools). */
export function makeFlowTitle(ask: string): string {
  if (ask.includes(MAKE_FLOW_BRIEF)) return 'Trip vlog, 30 seconds';
  if (ask.includes(EDIT_JOURNEY_ASK)) return 'Half speed and a crossfade';
  return ask.includes(MAKE_FLOW_SWAP_REFERENCE) ? 'Like my beach reel' : 'Like my trip reel';
}

/** What the stand-in vision model sees: the reel's shots, in the order the Analyst looks at them. */
export function makeFlowVisionDescription(index: number): string {
  return REFERENCE_SHOTS[index % REFERENCE_SHOTS.length]!.description;
}

export function makeFlowTurn(view: RequestView): DemoTurn {
  if (view.skill === 'timeline.editor' && isCommentsAsk(view.ask)) return commentsTurn(view);
  if (view.skill === 'timeline.librarian') return librarianTurn(view);
  const current = resumeProgress(view);
  return carryProgress(current, flowTurn(current));
}

function flowTurn(view: RequestView): DemoTurn {
  switch (view.skill) {
    case 'templates.analyst':
      return analystTurn(view);
    case 'timeline.librarian':
      return librarianTurn(view);
    case 'timeline.editor':
      // EDT1-CMT: a batch of comments is its own Editor step (make-flow-comments.ts).
      return isCommentsAsk(view.ask) ? commentsTurn(view) : editorTurn(view);
    case 'timeline.maker':
      // AGT2: the Maker finishes like the Editor did, then drafts once and hands off with the draft.
      return editorTurn(view, true);
    case 'render.reviewer':
      return reviewerTurn(view);
    case 'agent.gaps':
      return gapsTurn(view);
    case 'agent.brief':
      return use('handOff', { text: 'A short vlog of the trip', formatId: 'vlog', targetSeconds: 30 });
    default:
      return mainTurn(view);
  }
}

/** The main model: a reel's path starts the reference flow, a typed brief the describe flow; then a short answer. */
function mainTurn(view: RequestView): DemoTurn {
  const reel = referenceIn(view.ask);
  if (view.tools.includes('startFlow') && reel && view.calls.length === 0)
    return use(
      'startFlow',
      { path: 'reference', reference: { kind: 'file', path: reel } },
      'I will break your reel down and make one like it from your footage.',
    );
  if (view.tools.includes('startFlow') && view.ask.includes(MAKE_FLOW_BRIEF) && view.calls.length === 0)
    return use(
      'startFlow',
      { path: 'describe', brief: { text: MAKE_FLOW_BRIEF, formatId: 'vlog', targetSeconds: 30 } },
      'I will make a 30 second vlog of your trip from your footage.',
    );
  if (view.ask.includes(EDIT_JOURNEY_ASK)) return { text: EDIT_JOURNEY_REPORT };
  return { text: 'Your video is exported. It passed every quality check.' };
}

/** The Analyst's progress-saving tools: once one has stored its work, the agent shows the turns before it as one line. */
const SAVERS = ['templates_judgeCut', 'templates_setIntents'];

/**
 * The Analyst judges the disputed cuts one at a time and writes the slots a page at a time (templates SPEC "Writing
 * the slots a page at a time"). Each templates.judgeCut and templates.setIntents is saved progress, so the latest
 * of them is where this step's visible calls begin: the breakdown, earlier verdicts and pages are stored, not shown.
 */
function analystTurn(view: RequestView): DemoTurn {
  const input = record(view.input);
  const saved = view.calls.filter((c) => SAVERS.includes(c.name)).at(-1);
  const since = saved ? view.calls.slice(view.calls.indexOf(saved) + 1) : view.calls;
  const at = saved ? afterSaved(saved) : afterBreakdown(view, input.projectId, record(input.reference).path);
  if ('turn' in at) return at.turn;
  const { breakdownId } = at;
  const judge = judgeTurn(view, breakdownId, at.judging);
  if (judge) return withReads(judge, at);
  const done = at.progress !== null && Number(at.progress.written) >= Number(at.progress.total);
  const page = done ? undefined : writeAnalystPage(view, since, breakdownId, at.progress === null);
  return withReads(page ?? finishTurn(view, input.projectId, breakdownId), at);
}

/** Where the Analyst stands, read from its latest saved call or the breakdown. */
interface AnalystAt {
  readonly note?: string;
  readonly breakdownId: unknown;
  /** The last judging state shown (the breakdown's, or the latest judgeCut's); null once a page is stored. */
  readonly judging: Json | null;
  /** The latest setIntents' `{ written, total }`; null before the first page is stored. */
  readonly progress: Json | null;
}

/** After a saved call: what it stored and returned. */
function afterSaved(saved: ToolCall): AnalystAt {
  const json = resultJson(saved.result);
  return {
    breakdownId: saved.input.breakdownId,
    judging: saved.name === 'templates_judgeCut' ? json : null,
    progress: saved.name === 'templates_setIntents' ? json : null,
  };
}

/** Before anything is saved: the breakdown (called first) and its first disputed cut. */
function afterBreakdown(
  view: RequestView,
  projectId: unknown,
  path: unknown,
): AnalystAt | { turn: DemoTurn } {
  const breakdown = need(view, 'templates_breakdown', { breakdownId: '/breakdownId', next: '/next' });
  if ('missing' in breakdown)
    return { turn: call(view, 'templates_breakdown', { projectId, path }, 'I will break the reel down.') };
  if (breakdown.turn) return breakdown;
  return {
    breakdownId: breakdown.json.breakdownId,
    judging: breakdown.json,
    progress: null,
    ...(breakdown.note ? { note: breakdown.note } : {}),
  };
}

/** The next disputed cut, judged as a model would from its frames: a cut only where the reel's shots change. */
function judgeTurn(view: RequestView, breakdownId: unknown, judging: Json | null): DemoTurn | undefined {
  const next = judging?.next ? record(judging.next) : null;
  if (!next) return undefined;
  return call(view, 'templates_judgeCut', {
    breakdownId,
    at: next.at,
    cut: SHOT_CHANGES.some((frame) => Math.abs(frame - Number(next.at)) <= 1),
  });
}

/** Every slot written: finalise, then hand off what it saved. */
function finishTurn(view: RequestView, projectId: unknown, breakdownId: unknown): DemoTurn {
  const finalised = need(view, 'templates_finalise', {
    templateId: '/templateId',
    version: '/version',
    slotCount: '/slotCount',
    breakdownId: '/breakdownId',
    unconfirmedCuts: '/unconfirmedCuts',
  });
  if ('missing' in finalised)
    return call(view, 'templates_finalise', { projectId, breakdownId, name: REFERENCE_TEMPLATE_NAME });
  if (finalised.turn) return finalised.turn;
  const template = finalised.json;
  return withReads(
    use(
      'handOff',
      {
        templateId: template.templateId,
        version: template.version,
        slotCount: template.slotCount,
        breakdownId: template.breakdownId ?? breakdownId,
        unconfirmedCuts: list(template.unconfirmedCuts),
      },
      `The reel has ${String(template.slotCount)} shots on a 120 BPM beat.`,
    ),
    finalised,
  );
}

function reviewerTurn(view: RequestView): DemoTurn {
  const input = record(view.input);
  const draft = need(view, 'render_draft', { renderId: '/render/id', passed: '/passed' });
  if ('missing' in draft)
    return call(
      view,
      'render_draft',
      { projectId: input.projectId, timelineId: input.timelineId, revision: input.version },
      'Rendering a draft to check it.',
    );
  if (draft.turn) return draft.turn;
  const fixes: unknown[] = [];
  const reads: { note?: string }[] = [draft];
  if (draft.json.passed !== true) {
    const result = callsTo(view, 'render_draft').at(-1)!;
    const count = collectionSize(view, result, 'failing');
    for (let index = 0; index < (count ?? 200) && fixes.length < 5; index++) {
      const failed = readCall(view, result, { fixes: `/failing/${index}/fixes` });
      if (failed.turn) return withReads(failed.turn, ...reads);
      reads.push(failed);
      if (failed.json.fixes === undefined) break;
      fixes.push(...list(failed.json.fixes));
    }
  }
  return withReads(
    use('handOff', {
      renderId: draft.json.renderId,
      timelineVersion: input.version,
      passed: draft.json.passed === true,
      fixes: fixes.slice(0, 5),
    }),
    ...reads,
  );
}
