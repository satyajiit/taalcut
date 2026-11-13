// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-UI: what the stand-in model does when the editor's docked chat asks for a designed graphic (the desktop journey
 * e2e/make-flow-edit-design.e2e.ts, on a video the make flow's reference journey made). As a model would:
 *
 * - The Editor reads the video's graphics (graphics.list), records the job for the Designer (graphics.design, the
 *   person's words and the second it comes on) and hands off. Nothing on the timeline changes in its step.
 * - The Designer (render.designer, the step the agent adds after the Editor's) writes the headline's composition
 *   into the project's workspace (workspace.write), checks it (workspace.lint), reads the timeline's revision
 *   (graphics.list) and proposes it at that second (workspace.place), then hands off the job as placed.
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
export const EDIT_DESIGN_PROPOSED =
  'I proposed a newspaper-style headline at 0:04. It plays in the viewer: choose Use it on its card to keep it.';

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
  return { text: EDIT_DESIGN_PROPOSED };
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
  const visible = callsTo(view, 'workspace_place').at(-1);
  if (visible && /^(?:Stored as (?:artifact|result)|\[Taalcut\] Read result) /.test(visible.result))
    state.placedSource = visible.result.split('\n')[0];
  const placed =
    visible ??
    (typeof state.placedSource === 'string'
      ? { name: 'workspace_place', input: {}, result: state.placedSource }
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
  if (typeof state.revision !== 'number') {
    const listed = need(view, 'graphics_list', { revision: '/revision' });
    if ('missing' in listed) return finish(call(view, 'graphics_list', { timelineId }));
    if (listed.turn) return finish(listed.turn);
    if (typeof listed.json.revision !== 'number')
      return { text: 'I could not observe the timeline revision for placement.' };
    state.revision = listed.json.revision;
  }
  return finish(
    call(
      view,
      'workspace_place',
      {
        projectId,
        timelineId,
        revision: state.revision,
        entry: EDIT_DESIGN_ENTRY,
        name: EDIT_DESIGN_NAME,
        request: EDIT_DESIGN_ASK,
        at: typeof job.at === 'number' ? job.at : EDIT_DESIGN_AT,
      },
      'Proposing it at 0:04.',
    ),
  );
}
