// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-UI: what the stand-in model does when the editor's docked chat asks for a designed graphic (the desktop journey
 * e2e/make-flow-edit-design.e2e.ts, on a video the make flow's reference journey made). As a model would:
 *
 * - The Editor reads the video's graphics (graphics.list), records the job for the Designer (graphics.design, the
 *   person's words and the second it comes on) and hands off. Nothing on the timeline changes in its step.
 * - The Designer (render.designer, the step the agent adds after the Editor's) writes the headline's composition
 *   into the project's workspace (workspace.write), checks it (workspace.lint), draws it over the video where it
 *   plays (workspace.renderOver) and places it at that second
 *   (workspace.placeOptions, DSG2: it is in the video at once, the first design of its set), then hands off the job
 *   as placed. The stand-in has one made-up design, so it says why there are fewer than three (fewerBecause).
 * - The run's last turn says what was done.
 *
 * The design is a made-up test fixture (edit-design-headline.ts), written here as a model would write one.
 */
import { EDIT_DESIGN_ENTRY, EDIT_DESIGN_HTML } from './edit-design-headline';
import type { RequestView } from './anthropic-view';
import {
  call,
  callsTo,
  list,
  need,
  notes,
  readCall,
  record,
  use,
  withNote,
  withReads,
} from './make-flow-reads';
import type { DemoTurn } from './script';
import { carryProgress, resumeProgress } from './make-flow-progress';

/** The docked message, typed into the editor's chat. */
export const EDIT_DESIGN_ASK = 'Add a newspaper-style headline at 0:04';
export const EDIT_DESIGN_ASKS: readonly string[] = [EDIT_DESIGN_ASK];
/** The second it comes on, as the ask says it. */
export const EDIT_DESIGN_AT = 4;
/** The composition's name, as the Designer names it. */
export const EDIT_DESIGN_NAME = 'Newspaper headline';
/** The idea the Designer states for it, in a line. */
export const EDIT_DESIGN_IDEA = 'A front page: a kicker over a bold headline on paper';
/** Why the job has one design: the stand-in has no more. */
export const EDIT_DESIGN_FEWER = 'One made-up design in this test.';
export const EDIT_DESIGN_ADDED =
  'I added a newspaper-style headline at 0:04. It is in your video now: change it or ask for another from its card.';

export const isEditDesignAsk = (ask: string): boolean =>
  EDIT_DESIGN_ASKS.some((known) => ask.includes(known));

export function editDesignTurn(view: RequestView): DemoTurn {
  if (view.skill === 'render.designer') return designerTurn(view);
  const current = resumeProgress(view);
  return carryProgress(current, nextTurn(current));
}

function nextTurn(view: RequestView): DemoTurn {
  if (view.skill === 'timeline.editor') return editorTurn(view);
  if (view.skill === 'render.designer') return designerTurn(view);
  return { text: EDIT_DESIGN_ADDED };
}

/** The Editor: the graphics for the revision, the job for the Designer, the handoff. */
function editorTurn(view: RequestView): DemoTurn {
  const { projectId, timelineId } = record(view.input);
  const listed = need(view, 'graphics_list', { revision: '/revision' });
  if ('missing' in listed)
    return call(view, 'graphics_list', { timelineId }, 'Looking at the graphics on the video first.');
  if (listed.turn) return listed.turn;
  const asked = need(view, 'graphics_design', {});
  if ('missing' in asked)
    return withReads(
      call(
        view,
        'graphics_design',
        { projectId, timelineId, request: EDIT_DESIGN_ASK, at: EDIT_DESIGN_AT },
        'Asking the Designer for a headline at 0:04.',
      ),
      listed,
    );
  if (asked.turn) return asked.turn;
  return withReads(
    use('handOff', { timelineId, revision: listed.json.revision }, 'The headline’s design is on the way.'),
    listed,
    asked,
  );
}

/** Only successful workflow facts survive between fitted views; no HTML or repeated tool transcript. */
function designerTurn(view: RequestView): DemoTurn {
  const input = record(view.input);
  const { projectId, timelineId } = input;
  const job = record(list(input.jobs)[0]);
  const prefix = '[stand-in designer] ';
  const state = { ...notes(view, prefix).at(-1) };
  const finish = (turn: DemoTurn) => withNote(turn, prefix + JSON.stringify(state));
  const visible = callsTo(view, 'workspace_placeOptions').at(-1);
  if (visible && /^(?:Stored as (?:artifact|result)|\[Taalcut\] Read result) /.test(visible.result))
    state.placedSource = visible.result.split('\n')[0];
  const placed =
    visible ??
    (typeof state.placedSource === 'string'
      ? { name: 'workspace_placeOptions', input: {}, result: state.placedSource }
      : undefined);
  if (placed) {
    const receipt = readCall(view, placed, {
      revision: '/revision',
      itemIds: '/itemIds',
      compositionId: '/compositionId',
    });
    if (receipt.turn) return finish(receipt.turn);
    return finish(
      use('handOff', {
        timelineId,
        revision: receipt.json.revision,
        results: [
          {
            jobId: job.jobId,
            outcome: 'placed',
            itemIds: receipt.json.itemIds,
            compositionId: receipt.json.compositionId,
            fewerBecause: EDIT_DESIGN_FEWER,
          },
        ],
      }),
    );
  }
  if (state.written !== true) {
    const wrote = need(view, 'workspace_write', {});
    if ('missing' in wrote)
      return finish(
        call(
          view,
          'workspace_write',
          { projectId, path: EDIT_DESIGN_ENTRY, text: EDIT_DESIGN_HTML },
          'Writing a newspaper-style headline: a kicker over a bold headline on paper.',
        ),
      );
    if (wrote.turn) return finish(wrote.turn);
    state.written = true;
  }
  if (state.lintPassed !== true) {
    const linted = need(view, 'workspace_lint', { passed: '/passed' });
    if ('missing' in linted)
      return finish(call(view, 'workspace_lint', { projectId, entry: EDIT_DESIGN_ENTRY }));
    if (linted.turn) return finish(linted.turn);
    if (linted.json.passed !== true) return { text: 'The proposed composition didn’t pass its checks.' };
    state.lintPassed = true;
  }
  const at = typeof job.at === 'number' ? job.at : EDIT_DESIGN_AT;
  // A design is drawn where it plays before it is placed.
  if (state.drawn !== true) {
    const drawn = need(view, 'workspace_renderOver', { passed: '/passed' });
    if ('missing' in drawn)
      return finish(
        call(
          view,
          'workspace_renderOver',
          { projectId, entry: EDIT_DESIGN_ENTRY, seconds: [1], over: 'footage', timelineId, at },
          'Looking at it over the video at 0:04.',
        ),
      );
    if (drawn.turn) return finish(drawn.turn);
    if (drawn.json.passed !== true) return { text: 'The headline didn’t draw as it should.' };
    state.drawn = true;
  }
  return finish(
    call(
      view,
      'workspace_placeOptions',
      {
        projectId,
        timelineId,
        options: [{ entry: EDIT_DESIGN_ENTRY, name: EDIT_DESIGN_NAME, idea: EDIT_DESIGN_IDEA }],
        request: EDIT_DESIGN_ASK,
        at,
      },
      'Putting it in the video at 0:04.',
    ),
  );
}
