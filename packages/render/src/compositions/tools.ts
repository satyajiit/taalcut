// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent's `graphics` tools (SPEC P3.12, HFW1): list a timeline's graphics, retime or reword one, or remove one
 * through its command, so an agent edit is the same undoable, audited step as the inspector's; and `graphics.design`
 * (design-tool.ts), the Editor's every new graphic and every change to one's look, a job for the Designer. A graphic
 * is a composition the Designer made: it places and sizes itself, and its words and colours are its variables.
 * Graphic text is someone's words, so it comes back with any look-alike untrusted fence defused.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  defineTool,
  defineToolModule,
  err,
  fromMilliseconds,
  GRAPHICS_COMMANDS,
  NO_TOOL_RETRY,
  ok,
  ulidSchema,
  ValidationError,
  type AsyncResult,
  type TimelineId,
  type ToolModule,
} from '@taalcut/core';
import type { TimelineAccess } from '../ports';
import { PLACES_ITSELF } from './composition-commands';
import { createDesignTool } from './design-tool';
import { listedGraphics } from './listed';
import { staleRevision } from './revision-check';
import {
  editInput,
  itemSchema,
  receiptSchema,
  removeInput,
  revision,
  useProposalInput,
} from './tool-schemas';

export interface CompositionToolDeps {
  readonly timelines: TimelineAccess;
  /** HFW1: told when graphics.design records a job in a run (design-tool.ts). */
  readonly designRecorded?: (runId: string) => void;
}

// 1.2.0 (DSG1-AUT): graphics.list shows the designed component an item is drawn with.
// 1.3.0 (EDT1-GFX): size, a designed component's values, moves by direction, and proposals in graphics.list.
// 1.4.0 (HFW1): graphics.list shows designed graphics' compositions; graphics.design; graphics.edit rewords them.
// 2.0.0 (HFW1 retire): a graphic is a composition: no components' catalogue, no graphics.add, no kit fields.
const TOOLS_VERSION = '2.0.0';

const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const READ_RETRY = { maxAttempts: 2, initialDelayMs: 500 };
const LOCAL = { network: 'none' } as const;

/** What every graphics write tool shares: it dispatches its command and is keyed by its payload. */
function writeTool<const C extends string>(command: C) {
  return {
    name: command,
    command,
    version: TOOLS_VERSION,
    costClass: 'local',
    sideEffect: 'write',
    timeoutMs: 10_000,
    retry: NO_TOOL_RETRY,
    permission: LOCAL,
    idempotencyKey: (input: unknown) => sha256([command, input]),
  } as const;
}

/**
 * A preflight gives useful errors; the same revision travels into the queue to close the read/write race.
 * Replay is handled by the command, after the history queue has validated admission.
 */
async function dispatchAt<
  I extends { readonly timelineId: TimelineId; readonly revision: number; readonly durationMs?: number },
>(
  deps: CompositionToolDeps,
  input: I,
  dispatch: (payload: unknown) => AsyncResult<unknown>,
): AsyncResult<unknown> {
  const timeline = await deps.timelines.get(input.timelineId);
  if (!timeline.ok) return timeline;
  if (timeline.value.revision !== input.revision)
    return err(staleRevision(input.timelineId, timeline.value.revision));
  const { durationMs, ...payload } = input;
  // Milliseconds stop at this edge: the command and the timeline speak media time.
  return dispatch(
    durationMs === undefined ? payload : { ...payload, duration: fromMilliseconds(durationMs) },
  );
}

export function compositionToolModule(deps: CompositionToolDeps): ToolModule {
  const list = defineTool({
    name: 'graphics.list',
    version: TOOLS_VERSION,
    description:
      'Lists the graphics on a timeline, with its revision: each one is a design (its composition: its name, the ' +
      'variables its words and colours are, and their values), its time, and whether it is still a proposal.',
    summary: 'Lists the graphics on a timeline: their designs, words, times and proposals.',
    tags: ['graphics', 'motion', 'list', 'title', 'design', 'composition'],
    input: z.object({ timelineId: ulidSchema('Timeline') }),
    output: z.object({ revision, items: z.array(itemSchema) }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 5_000,
    retry: READ_RETRY,
    permission: LOCAL,
    run: async (input) => {
      const timeline = await deps.timelines.get(input.timelineId);
      if (!timeline.ok) return timeline;
      return ok({ revision: timeline.value.revision, items: listedGraphics(timeline.value) });
    },
  });
  const editOutput = receiptSchema.omit({ itemId: true });
  const edit = defineTool({
    ...writeTool(GRAPHICS_COMMANDS.edit),
    description:
      "Changes a graphic's timing (anchor), its length, or its words and colours by `params` (its design's " +
      'variables by name, as graphics.list names them). A designed graphic places and sizes itself: moving, ' +
      'resizing or restyling it is graphics.design. A proposed graphic edits the same way. Undoable.',
    // EDT1-GFX: the words people use for a graphic they want changed, so the Editor's step loads it (ops's edit eval).
    summary: 'Changes a graphic: rewords or retimes it.',
    // A move or a size loads it too, so its refusal can point to graphics.design.
    tags: [
      'graphics',
      'graphic',
      'edit',
      'change',
      'move',
      'up',
      'down',
      'smaller',
      'bigger',
      'larger',
      'resize',
      'size',
      'reword',
      'rename',
      'words',
      'title',
      'name',
      'timing',
      'motion',
      'lower-third',
      'sticker',
      'label',
      'callout',
    ],
    input: editInput,
    output: editOutput,
    run: async (input, ctx) => {
      const { move, resize, placement, scale, ...rest } = input;
      // HFW1: a designed graphic places and sizes itself; moving it is the Designer's.
      if (move || resize || placement !== undefined || scale !== undefined)
        return err(
          ValidationError({ field: move || placement ? 'move' : 'resize' }, { detail: PLACES_ITSELF }),
        );
      const done = await dispatchAt(deps, rest, ctx.dispatch);
      return done.ok ? ok(editOutput.parse(done.value)) : done;
    },
  });
  const removeOutput = receiptSchema.pick({ revision: true, timelineId: true, affectedItemIds: true });
  const remove = defineTool({
    ...writeTool(GRAPHICS_COMMANDS.remove),
    description:
      'Removes one or more graphics or text overlays from the timeline (pass itemId or itemIds[]). Undoable.',
    summary: 'Removes one or more graphics or text overlays in a single step.',
    tags: [
      'graphics',
      'graphic',
      'remove',
      'delete',
      'off',
      'lower-third',
      'title',
      'sticker',
      'label',
      'callout',
      'batch',
      'bulk',
    ],
    input: removeInput,
    output: removeOutput,
    run: async (input, ctx) => {
      if (!input.itemId && (!input.itemIds || input.itemIds.length === 0)) {
        return err(ValidationError({ field: 'itemId' }, { detail: 'Give itemId or itemIds.' }));
      }
      const done = await dispatchAt(deps, input, ctx.dispatch);
      return done.ok ? ok(removeOutput.parse(done.value)) : done;
    },
  });
  // HFW1: the Editor's design jobs, for the Designer's step after its own.
  const design = createDesignTool({
    timelines: deps.timelines,
    ...(deps.designRecorded ? { recorded: deps.designRecorded } : {}),
  });
  const useProposal = defineTool({
    ...writeTool(GRAPHICS_COMMANDS.useProposal),
    description:
      'Applies an existing graphics proposal when the person asks to use it. Read graphics.list for its id and revision. Undoable.',
    summary: 'Uses a proposed graphic in the video.',
    tags: ['graphics', 'proposal', 'accept', 'use'],
    input: useProposalInput,
    output: removeOutput,
    run: async (input, ctx) => {
      const done = await dispatchAt(deps, input, ctx.dispatch);
      return done.ok ? ok(removeOutput.parse(done.value)) : done;
    },
  });
  return defineToolModule({ id: 'graphics', tools: [list, edit, remove, design, useProposal] });
}
