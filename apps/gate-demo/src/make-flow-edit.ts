// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the stand-in Editor asked in the editor's chat (its input has `request`). It knows one ask, the
 * editor's journey: "make this half speed and add a crossfade into the next one", on the clip the step's targets
 * name (else the editor context's selection): timeline.setSpeed, then timeline.setTransition on the same clip with
 * edge "end", then the handoff with a one-line report. Any other ask hands off unchanged, saying so.
 */
import type { RequestView } from './anthropic-view';
import { call, callsTo, list, record, use, type Json } from './make-flow-reads';
import type { DemoTurn } from './script';

export const EDIT_JOURNEY_ASK = 'Make this half speed and add a crossfade into the next one.';
export const EDIT_JOURNEY_REPORT = 'This clip now plays at half speed, with a crossfade into the next one.';

/** The clip the ask points at: the first item target, else the first selected item. */
function pointedClip(input: Json): unknown {
  const targets = [...list(input.targets), ...list(record(input.context).selection)].map(record);
  return targets.find((target) => target.kind === 'item')?.itemId;
}

export function editRequestTurn(view: RequestView, input: Json, revision: () => unknown): DemoTurn {
  const { projectId, timelineId } = input;
  const clipId = pointedClip(input);
  const known = String(input.request ?? '')
    .toLowerCase()
    .includes('half speed');
  if (!known || !clipId)
    return use(
      'handOff',
      { timelineId, revision: revision() },
      'I left the video as it was: this demo knows one edit.',
    );
  if (callsTo(view, 'timeline_setSpeed').length === 0)
    return call(view, 'timeline_setSpeed', { projectId, timelineId, clipId, speed: 0.5 });
  if (callsTo(view, 'timeline_setTransition').length === 0)
    return call(view, 'timeline_setTransition', {
      projectId,
      timelineId,
      clipId,
      edge: 'end',
      kind: 'dissolve',
    });
  return use('handOff', { timelineId, revision: revision() }, EDIT_JOURNEY_REPORT);
}
