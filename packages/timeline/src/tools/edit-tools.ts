// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One write tool per edit command: the tool's input is the command's payload,
 * and the command (not the tool) refuses agent edits on locked clips. Each
 * dispatch is one undo step, re-sync included.
 */
import {
  err,
  ok,
  RationalTime,
  TIMELINE_COMMANDS,
  type AnyTool,
  type AsyncResult,
  type Result,
  type Timeline,
  type ToolContextBase,
} from '@taalcut/core';
import { medianItemFrames, videoItems } from '../model/sequence';
import { beatGrid } from '../resync/grid';
import type { z } from 'zod';
import { InvalidMove } from '../errors';
import { mendMoveFields, mendTrimFields } from './clip-mend';
import { createClipNumbering, idsOnly, numberedClips, oneClipId, type ClipRef } from './clip-refs';
import { editCommandTool } from './edit-command-tool';
import { guardPointing } from './pointing-guard';
import type { EditorToolDeps } from './editor-tools';
import { ms } from './editor-payloads';
import { editInputs } from './json';

const EDITS = [
  {
    command: TIMELINE_COMMANDS.swapClip,
    description:
      "Swaps the media of one clip, keeping its place, length and id: from an alternate on the cast board, a library search hit, or the agent's own pick. Without sourceStart the in-point puts a motion peak on the clip's beat. The old pick joins the alternates.",
    summary: "Swaps one clip's media, keeping its place, length and id.",
    tags: ['swap', 'cast'],
  },
  {
    command: TIMELINE_COMMANDS.trimClip,
    description:
      'Trims one edge of a clip (its number, or "this") by a signed time, by: {"seconds": 1} is a second longer, {"beats": -1} a beat shorter; positive lengthens. Between two clips the cut rolls (the neighbour gives the frames); the first edge slips the in-point; the last edge ripples the video\'s length. The moved cut snaps to the beat.',
    summary: 'Trims one edge of a clip, making it shorter or longer; the moved cut snaps back onto the beat.',
    tags: ['trim', 'shorter', 'longer', 'shorten', 'lengthen', 'length', 'second', 'beat', 'edge'],
  },
  {
    command: TIMELINE_COMMANDS.moveClip,
    description:
      'Moves a clip (its number, or "this") to another place: to is where it goes, counted like the clips: "start" (or 1), "end", or the number it will have (3 makes it the third clip). Positions keep their lengths and beats, so the clip takes its new position\'s length, with its in-point chosen again around its motion peak.',
    summary:
      'Moves a clip to another place in the order (the start, the end); positions keep their lengths and beats.',
    tags: ['reorder', 'order', 'move', 'position', 'end', 'start', 'first', 'open', 'opening'],
  },
  {
    command: TIMELINE_COMMANDS.editText,
    description:
      "Replaces the wording, timing (atSeconds, durationSeconds), box, or removes one or more on-screen text items (via itemId or batch edits[]). Write wording for the user's footage, in your own words.",
    summary: 'Edits, retimes, moves or removes one or more on-screen text items in a single step.',
    tags: [
      'text',
      'title',
      'words',
      'say',
      'says',
      'wording',
      'reword',
      'rewrite',
      'change',
      'line',
      'overlay',
      'duration',
      'timing',
      'remove',
      'delete',
      'batch',
      'bulk',
    ],
  },
  {
    command: TIMELINE_COMMANDS.moveText,
    description:
      'Moves the normalised bounding box (x, y, width, height in 0..1) of one or more on-screen text items (via itemId, itemIds[], or moves[]), e.g. into the platform safe area for a QA fix.',
    summary:
      'Moves one or more on-screen texts (the title or other lines) in the frame: up, down, to the top or bottom.',
    tags: [
      'text',
      'title',
      'position',
      'up',
      'down',
      'top',
      'bottom',
      'box',
      'safe-zone',
      'qa',
      'fix',
      'batch',
      'bulk',
    ],
  },
  {
    command: TIMELINE_COMMANDS.lockClip,
    description:
      'Sets protection on a numbered scene only when the person explicitly asks to lock or unlock it. Never remove protection to bypass refused edits. Protected scenes stay out of ordinary changes and re-casting.',
    summary: 'Protects or unprotects a numbered scene.',
    tags: ['lock', 'unlock', 'protect', 'protection'],
  },
  {
    command: TIMELINE_COMMANDS.applyCast,
    description:
      'Applies new picks to cast slots in one step, e.g. after a vision rerank: each listed slot gets its pick (with its in-point) unless the user locked or changed it since.',
    summary: 'Applies new picks to cast slots in one step, skipping what the user locked or changed.',
    tags: ['rerank', 'cast'],
  },
  {
    command: TIMELINE_COMMANDS.setClipFit,
    description:
      'Sets how one clip fills the 9:16 frame: cover (crop to fill) or contain (whole picture with bars). A QA fix; moves no cut.',
    summary: 'Sets one clip to fill the frame (cover) or show whole (contain).',
    tags: ['fit', 'qa', 'fix'],
  },
  {
    command: TIMELINE_COMMANDS.resyncBeats,
    description:
      "Puts every cut, the end included, back onto the timeline's beat grid in one step. A QA fix for cuts that drifted off the beat.",
    summary: 'Puts every cut back onto the beat grid.',
    tags: ['beat', 'qa', 'fix'],
  },
  {
    command: TIMELINE_COMMANDS.trimToDuration,
    description:
      "Shortens the video from its end to at most maxSeconds, ending on a beat: the clip crossing the limit gets shorter and what's after it goes. A QA fix for a video too long for the platform.",
    summary: 'Shortens the video from its end to fit the platform, ending on a beat.',
    tags: ['duration', 'trim', 'qa', 'fix'],
  },
  {
    command: TIMELINE_COMMANDS.setReframe,
    description:
      "Sets which part of one video clip's frame shows: auto follows the subject, subject or centre hold it, blurPad fits the whole picture on a blurred fill; nudge moves the framing and scale above 1 punches in (1.1 reads as natural). null goes back to the plain fit. Moves no cut.",
    summary: "Sets one video clip's framing: follow the subject, centre, blurred pad, or a punch-in.",
    tags: ['reframe', 'framing', 'punch-in'],
  },
] as const;

type TrimToolInput = z.output<(typeof editInputs)['timeline.trimClip']>;
type MoveClipToolInput = z.output<(typeof editInputs)['timeline.moveClip']>;

/**
 * EDT1-OPS: a clip given by its number or "this" (clip-refs.ts) as its id, which the command takes; an id alone
 * goes through.
 */
async function clipIdOf(
  input: {
    readonly timelineId: string;
    readonly clip?: ClipRef | undefined;
    readonly clipId?: string | undefined;
    readonly revision?: number | undefined;
  },
  ctx: ToolContextBase,
  deps: EditorToolDeps,
): AsyncResult<string> {
  if (input.clip === undefined) {
    if (input.clipId === undefined)
      return err(InvalidMove(undefined, { detail: 'Give the clip: its number (clip), or "this".' }));
    return ok(input.clipId);
  }
  const given = idsOnly([input.clip]);
  if (given) return ok(given[0]!);
  if (!deps.service) return err(InvalidMove(undefined, { detail: 'Give the clip’s id.' }));
  const timeline = await deps.service.read(input.timelineId as Timeline['id']);
  if (!timeline.ok) return timeline;
  return oneClipId(input, {
    timeline: timeline.value,
    editor: ctx.editor,
    revision: input.revision,
    describe: deps.shotDescriptions,
    numbering: deps.numbering,
    runId: ctx.runId,
  });
}

/**
 * timeline.trimClip's payload: `by` as the command's own form. Seconds become milliseconds (rounded to frames by the
 * edit), beats frames of the beat grid, and frames go on as given.
 */
async function trimPayload(input: TrimToolInput, ctx: ToolContextBase, deps: EditorToolDeps) {
  const clipId = await clipIdOf(input, ctx, deps);
  if (!clipId.ok) return clipId;
  const { by, clip: _clip, ...rest } = input;
  const payload = { ...rest, clipId: clipId.value };
  if ('seconds' in by) return ok({ ...payload, by: ms(by.seconds) });
  if (!('beats' in by)) return ok({ ...payload, by });
  const byBeats = by.beats;
  // EDT1-OPS: beats as frames of the grid the cuts keep to (timeline.get's beat).
  if (!deps.service) return err(InvalidMove(undefined, { detail: 'The timeline can’t be read here.' }));
  const timeline = await deps.service.read(input.timelineId as Timeline['id']);
  if (!timeline.ok) return timeline;
  const rate = timeline.value.canvas.rate;
  const interval = beatGrid(
    timeline.value.beatMap,
    rate,
    medianItemFrames(videoItems(timeline.value)),
  ).interval;
  if (!interval)
    return err(
      InvalidMove(undefined, { detail: 'This video has no beat to count: give by as {"seconds": n}.' }),
    );
  return ok({ ...payload, by: RationalTime.of(Math.round(byBeats * interval), rate) });
}

/**
 * timeline.moveClip's payload: the clip as its id, and `to` (counted like the clips, from 1) as the command's
 * `toIndex`, the position (from 0, a gap counted) of the clip that has that number now, so the moved clip has it after.
 */
async function moveClipPayload(input: MoveClipToolInput, ctx: ToolContextBase, deps: EditorToolDeps) {
  const clipId = await clipIdOf(input, ctx, deps);
  if (!clipId.ok) return clipId;
  if (!deps.service) return err(InvalidMove(undefined, { detail: 'The timeline can’t be read here.' }));
  const timeline = await deps.service.read(input.timelineId as Timeline['id']);
  if (!timeline.ok) return timeline;
  const toIndex = positionFor(input.to, timeline.value);
  if (!toIndex.ok) return toIndex;
  const { clip: _clip, to: _to, ...rest } = input;
  return ok({ ...rest, clipId: clipId.value, toIndex: toIndex.value });
}

/** `to` as a position on the video track (clips and gaps, transitions not counted), from 0. */
function positionFor(to: MoveClipToolInput['to'], timeline: Timeline): Result<number> {
  const positions = videoItems(timeline).filter((item) => item.type !== 'transition');
  const clips = numberedClips(timeline);
  if (to === 'start') return ok(0);
  if (to === 'end') return ok(positions.length - 1);
  const number = typeof to === 'number' ? to : /^\d+$/.test(to.trim()) ? Number(to.trim()) : NaN;
  // One past the last clip (an older caller's toIndex of the clip count, "after the last") is the end.
  if (number === clips.length + 1) return ok(positions.length - 1);
  const clip = Number.isInteger(number) ? clips[number - 1] : undefined;
  if (!clip) {
    return err(
      InvalidMove(undefined, {
        detail: `to is "start", "end" or the number the clip will have, 1 to ${clips.length} (the video has ${clips.length} clips): not ${JSON.stringify(to)}.`,
      }),
    );
  }
  return ok(positions.findIndex((item) => item.id === clip.id));
}

/** Any other tool on one clip (a swap, a lock, the fit, the framing): the clip as its id, the rest unchanged. */
async function oneClipPayload(
  input: Parameters<typeof clipIdOf>[0] & Record<string, unknown>,
  ctx: ToolContextBase,
  deps: EditorToolDeps,
) {
  const clipId = await clipIdOf(input, ctx, deps);
  if (!clipId.ok) return clipId;
  const { clip: _clip, ...rest } = input;
  return ok({ ...rest, clipId: clipId.value });
}

type EditTextToolInput = z.output<(typeof editInputs)['timeline.editText']>;
type MoveTextToolInput = z.output<(typeof editInputs)['timeline.moveText']>;

function clampBox(box: { x: number; y: number; width: number; height: number }) {
  const inside = (at: number, size: number) => Math.max(0, Math.min(at, 1 - size));
  return { ...box, x: inside(box.x, box.width), y: inside(box.y, box.height) };
}

/** timeline.editText's payload: converts seconds to RationalTime and clamps any boxes inside the frame. */
async function editTextPayload(input: EditTextToolInput) {
  if (!input.itemId && (!input.edits || input.edits.length === 0)) {
    return err(InvalidMove(undefined, { detail: 'Give itemId or edits.' }));
  }
  const { atSeconds, durationSeconds, box, edits, ...rest } = input;
  return ok({
    ...rest,
    ...(atSeconds !== undefined ? { start: ms(atSeconds) } : {}),
    ...(durationSeconds !== undefined ? { duration: ms(durationSeconds) } : {}),
    ...(box !== undefined ? { box: clampBox(box) } : {}),
    ...(edits
      ? {
          edits: edits.map(({ atSeconds: at, durationSeconds: dur, box: entryBox, ...entry }) => ({
            ...entry,
            ...(at !== undefined ? { start: ms(at) } : {}),
            ...(dur !== undefined ? { duration: ms(dur) } : {}),
            ...(entryBox !== undefined ? { box: clampBox(entryBox) } : {}),
          })),
        }
      : {}),
  });
}

/** timeline.moveText's payload: a box that runs off the frame is slid back inside it, its size kept. */
async function moveTextPayload(input: MoveTextToolInput) {
  if (
    (!input.box || (!input.itemId && (!input.itemIds || input.itemIds.length === 0))) &&
    (!input.moves || input.moves.length === 0)
  ) {
    return err(InvalidMove(undefined, { detail: 'Give itemId/itemIds with box, or moves.' }));
  }
  const { box, moves, ...rest } = input;
  const fallbackBox = box ?? moves?.[0]?.box;
  if (!fallbackBox) {
    return err(InvalidMove(undefined, { detail: 'Give itemId/itemIds with box, or moves.' }));
  }
  return ok({
    ...rest,
    box: clampBox(fallbackBox),
    ...(moves ? { moves: moves.map((move) => ({ itemId: move.itemId, box: clampBox(move.box) })) } : {}),
  });
}

type Payload = (input: never, ctx: ToolContextBase, deps: EditorToolDeps) => AsyncResult<unknown>;

const PAYLOADS: Partial<Record<string, Payload>> = {
  [TIMELINE_COMMANDS.trimClip]: trimPayload as Payload,
  [TIMELINE_COMMANDS.moveClip]: moveClipPayload as Payload,
  [TIMELINE_COMMANDS.swapClip]: oneClipPayload as Payload,
  [TIMELINE_COMMANDS.lockClip]: oneClipPayload as Payload,
  [TIMELINE_COMMANDS.setClipFit]: oneClipPayload as Payload,
  [TIMELINE_COMMANDS.setReframe]: oneClipPayload as Payload,
  [TIMELINE_COMMANDS.editText]: editTextPayload as Payload,
  [TIMELINE_COMMANDS.moveText]: moveTextPayload as Payload,
};

/** The tools whose `clipId` is now `clip`. */
const RENAMED: ReadonlySet<string> = new Set([TIMELINE_COMMANDS.trimClip, TIMELINE_COMMANDS.moveClip]);

export function editTools(deps: EditorToolDeps = {}): AnyTool[] {
  const withNumbering = { ...deps, numbering: deps.numbering ?? createClipNumbering() };
  return EDITS.map((edit) => {
    const payload = PAYLOADS[edit.command];
    return editCommandTool({
      ...edit,
      service: deps.service,
      input: editInputs[edit.command] as z.ZodType,
      // EDT1-OPS: trimClip and moveClip renamed `clipId` to `clip`; an older caller's `clipId` is mended to it, a
      // trim's `bySeconds` or `byBeats` becomes its `by` (one kept when two came), and a move's `toIndex` (from 0)
      // becomes `to` (from 1).
      ...(RENAMED.has(edit.command)
        ? { mendInput: edit.command === TIMELINE_COMMANDS.trimClip ? mendTrimFields : mendMoveFields }
        : {}),
      ...(payload
        ? {
            payload: async (input, _artifacts, ctx) => {
              const made = await payload(input as never, ctx, withNumbering);
              if (!made.ok) return made;
              // EDT1-OPS: a change away from what the person pointed at, refused once (pointing-guard.ts).
              const pointing = await guardPointing(
                edit.command,
                made.value as Record<string, unknown>,
                input as Record<string, unknown>,
                ctx,
                withNumbering,
              );
              return pointing.ok ? made : pointing;
            },
          }
        : {}),
    });
  });
}
