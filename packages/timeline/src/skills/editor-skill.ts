// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Editor (P2-M4; 2.0 in EDT1): a skilled editor on one timeline. Asked in the editor's chat (`request`, with
 * the editor as the person saw it in `context`), it makes any edit an editor makes: cuts, order, trims, speed,
 * transitions, colour, sound, text, captions, framing, style, graphics, music, effects and voice. In the make flow
 * (no request) it finishes an assembled timeline: its text, QA's fixes and a cleanup. AGT2: both modes have every
 * tool. The make flow's finish withheld 33 of them (slip, reframe, speed, transitions, graphics.design, ducking),
 * while QA's reframe and ducking fixes and the Reviewer's graphics fixes were still sent to it.
 */
import {
  defineSkill,
  editorCapabilityTools,
  type EditorCapability,
  EDIT_ITEM_KINDS,
  editTargetJsonSchema,
  MAX_EDITOR_SELECTION,
  ok,
  parseEditTarget,
  qaFixSchema,
  RationalTime,
  rationalTimeJsonSchema,
  ulidSchema,
  type EditTargetJson,
  type SkillVerdict,
} from '@taalcut/core';
import { z } from 'zod';
import { asksOnlyForPostCopy } from './editor-post-copy';
import { cutsOffAnchor, timelineStats } from '../model/checks';
import type { TimelineService } from '../service/service';
import type { ClipNumbering } from '../tools/clip-refs';
import { AI_CONTEXT_TOOLS, EDITOR_GRAPHICS_TOOLS, WORKSPACE_COMPOSITION_TOOLS } from './editor-graphics';
import { editorPrompt } from './editor-prompt';
import { editorOutputSchema } from './editor-output';
import { EDITOR_EDITS_PROMPT, EDITOR_PLUGIN_TOOLS } from './editor-plugins';

export { editorOutputSchema } from './editor-output';

export { AI_CONTEXT_TOOLS, WORKSPACE_COMPOSITION_TOOLS };

const timelineId = ulidSchema('Timeline');
/** AGT2: the most fixes one step takes: a review's, or a draft's slot-match fixes, one per slot or more. */
export const MAX_FIXES = 60;

interface Time {
  readonly value: number;
  readonly rate: { readonly num: number; readonly den: number };
}
interface Range {
  readonly start: Time;
  readonly duration: Time;
}

const exact = (time: Time) => (time.value * time.rate.den) / time.rate.num;
/** Seconds to two decimals: what timeline.get and the edit tools use. */
const seconds = (value: number) => Math.round(value * 100) / 100;
const span = (range: Range): [number, number] => [
  seconds(exact(range.start)),
  seconds(exact(range.start) + exact(range.duration)),
];

/**
 * Edit targets as a model writes them (core's editTargetJsonSchema), each checked with parseEditTarget: real ids, a
 * valid rate, no negative length. An item may leave its kind out (ctx's 6f726654): its id names it, the timeline
 * knows its kind (resolveEditTarget), and the Editor reads it with timeline.get, so only its shape is checked here.
 */
const checkedTargets = z
  .array(editTargetJsonSchema)
  .max(MAX_EDITOR_SELECTION)
  .superRefine((targets, ctx) =>
    targets.forEach((target, index) => {
      // An item with no kind, or with its kind written as `kind` ({ kind: 'clip', itemId }): only its shape.
      const loose =
        target.kind !== 'range' && target.kind !== 'timeline' && (target.kind !== 'item' || !target.itemKind);
      if (!loose && !parseEditTarget(target))
        ctx.addIssue({ code: 'custom', path: [index], message: 'Not an edit target' });
    }),
  );

/**
 * Core's editorContextSchema (ctx's contract) with JSON-able ids and times, as a skill input must be: the same
 * fields and limits, its targets core's editTargetJsonSchema. A test holds the two to each other.
 */
const rangeJson = z.object({ start: rationalTimeJsonSchema, duration: rationalTimeJsonSchema });
export const editorContextJsonSchema = z.object({
  timelineId,
  revision: z.int().min(1),
  playhead: rationalTimeJsonSchema.refine((time) => time.value >= 0, { message: 'Before zero' }),
  selection: checkedTargets,
  visibleRange: rangeJson.optional(),
});

/** One target as the model reads it: an item by the id the tools take, a stretch in seconds, or the whole video. */
const focusTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('item'), itemKind: z.enum(EDIT_ITEM_KINDS).optional(), itemId: z.string() }),
  z.object({ kind: z.literal('range'), fromSeconds: z.number().min(0), toSeconds: z.number().min(0) }),
  z.object({ kind: z.literal('timeline') }),
]);
export type FocusTarget = z.output<typeof focusTargetSchema>;

export function focusTarget(target: EditTargetJson): FocusTarget {
  if (target.kind === 'timeline') return { kind: 'timeline' };
  if (target.kind === 'range') {
    const [fromSeconds, toSeconds] = span(target.range);
    return { kind: 'range', fromSeconds, toSeconds };
  }
  // An item, or one a model wrote with its kind as `kind` ({ kind: 'clip', itemId }); its kind may be left out.
  const itemKind = target.kind === 'item' ? target.itemKind : target.kind;
  return { kind: 'item', ...(itemKind ? { itemKind } : {}), itemId: target.itemId };
}

/** The editor context as the model reads it: times in seconds, like timeline.get; items by the id the tools take. */
export const editorFocusSchema = z.object({
  timelineId,
  revision: z.int().min(1),
  playheadSeconds: z.number().min(0),
  selection: z.array(focusTargetSchema).max(MAX_EDITOR_SELECTION),
  visibleSeconds: z.tuple([z.number(), z.number()]).optional(),
});
export type EditorFocus = z.output<typeof editorFocusSchema>;

export function editorFocus(context: z.output<typeof editorContextJsonSchema>): EditorFocus {
  return {
    timelineId: context.timelineId,
    revision: context.revision,
    playheadSeconds: seconds(exact(context.playhead)),
    selection: context.selection.map(focusTarget),
    ...(context.visibleRange ? { visibleSeconds: span(context.visibleRange) } : {}),
  };
}

export const editorInputSchema = z.object({
  projectId: ulidSchema('Project'),
  timelineId,
  /** The template the timeline was cast from (the make flow's); absent for an edit asked in the editor's chat. */
  templateId: ulidSchema('Template').optional(),
  fixes: z.array(qaFixSchema).max(MAX_FIXES).optional(),
  /** P3-V9: tighten a talking head first (timeline.planCleanup, then applyCleanup). */
  cleanup: z.boolean().optional(),
  /** EDT1: what the person asked for in the editor's chat, in their words. Absent: finish the assembled timeline. */
  request: z.string().trim().min(1).max(2000).optional(),
  /**
   * EDT1: the editor as the person saw it when they asked (core's EditorContext, from the docked composer), which the
   * step's input shows the model in seconds (editorFocus). A logged input, already in seconds, parses unchanged.
   */
  context: z.union([editorContextJsonSchema.transform(editorFocus), editorFocusSchema]).optional(),
  /**
   * EDT1: what the request is about, as the chat routes it (ctx: the editor context's targets, core's
   * editTargetJsonSchema, each checked with parseEditTarget); the model reads them like the context's selection. They
   * are what "this", "these" and "here" mean. A logged input, already read, parses unchanged.
   */
  targets: z
    .union([
      checkedTargets.transform((targets) => targets.map(focusTarget)),
      z.array(focusTargetSchema).max(MAX_EDITOR_SELECTION),
    ])
    .optional(),
});
export type EditorInput = z.output<typeof editorInputSchema>;

/** The edits a person asks for in the chat, and (AGT2) the make flow's finish too. */
export const REQUEST_TOOL_NAMES = [
  'timeline.splitClip',
  'timeline.deleteClip',
  'timeline.insertClip',
  'timeline.duplicateClip',
  'timeline.setSpeed',
  'timeline.setTransition',
  'timeline.removeTransition',
  'timeline.setGrade',
  'timeline.addMarker',
  // FIX-TRIM: another part of a clip's shot.
  'timeline.slipClip',
  'timeline.setReframe',
  'timeline.setStyle',
  'audio.setVolume',
  'audio.trim',
  'audio.move',
  'library.search',
  'library.getAsset',
] as const;

/**
 * AGT2-SBX: the workspace shell (render's workspace.open, exec, files and importMedia), for what no other tool does.
 * The Editor and the Maker list them only where the composition registers them.
 */
export const WORKSPACE_SHELL_TOOLS = [
  'workspace.open',
  'workspace.exec',
  'workspace.files',
  'workspace.importMedia',
] as const;

/** What both modes use. */
export const SHARED_TOOL_NAMES = [
  'timeline.get',
  'timeline.editText',
  'timeline.moveText',
  'timeline.trimClip',
  'timeline.swapClip',
  'timeline.moveClip',
  'timeline.findAlternates',
  'timeline.setClipFit',
  'timeline.resyncBeats',
  'timeline.trimToDuration',
  'timeline.planCleanup',
  'timeline.applyCleanup',
] as const;

/** The project's style set (the make flow's finish reads it first). */
export const FINISH_TOOL_NAMES = ['templates.styleProfile'] as const;

/** The generation families' tools (music, sfx, voice), where they are composed. */
export const GENERATION_TOOL_NAMES = [
  'music.generate',
  'music.setDucking',
  'music.findLibraryTrack',
  'music.useLibraryTrack',
  'sfx.addHits',
  'sfx.generateHit',
  'voice.fitScript',
  'voice.listVoices',
  'voice.generate',
  'voice.editLine',
  'voice.place',
  'voice.finalize',
] as const;

export interface EditorSkillDeps {
  readonly capabilities?: readonly EditorCapability[];
  readonly service: Pick<TimelineService, 'read'>;
  /**
   * Tool families the composition offers beyond captions: `music`, `sfx` and `voice` where generation is set up. A
   * family the skill names must have a registered tool, or the skill module isn't composed.
   */
  readonly families?: readonly ('music' | 'sfx' | 'voice')[];
  /**
   * EDT1-OPS: the clips' numbering the tools share (`clipNumberingOf` the store), for the check's ask: a docked run
   * that changed nothing without reading the timeline. Absent: no ask.
   */
  readonly numbering?: ClipNumbering;
  /** AGT2: whether a tool is registered in the composition, for the workspace shell's tools. Absent: none listed. */
  readonly registered?: (tool: string) => boolean;
  /** Whether to include extended workspace composition and AI context tools when registered (default: true). */
  readonly extendedTools?: boolean;
}

const retry = (reason: string): SkillVerdict => ({ verdict: 'retry', reason });

/** EDT1-OPS: the Editor's check, for a docked run that changed nothing and never read the timeline. */
const UNREAD_REASON =
  'Nothing changed, and the timeline was never read: the note lists the clips by number only, and what each ' +
  'clip shows ("the dog") is in timeline.get. Read it, then make the change, or say why you can\'t.';

/** The longest stretch of the person's words the check quotes back. */
const QUOTED_REQUEST_MAX = 200;

/** EDT1-OPS: the Editor's check, for a docked run that read the timeline and changed nothing: what was asked. */
function unchangedReason(request: string): string {
  // FIX-CMT: a comment batch's request fences the comments' words; a cut quote would leave them outside the fence.
  if (request.includes('<untrusted'))
    return (
      'Nothing in the video changed, and your request lists the comments. If one asks for a change, make it now ' +
      "with the tools. If it can't be made, or asks for nothing to change, answer it saying why, then hand off again."
    );
  const words = request.replace(/\s+/g, ' ').replaceAll('"', "'").trim();
  const quoted = words.length > QUOTED_REQUEST_MAX ? `${words.slice(0, QUOTED_REQUEST_MAX - 1)}…` : words;
  return (
    `Nothing in the video changed, and the person asked: "${quoted}". If that asks for a change, make it now with ` +
    "the tools. If it can't be made, or asks for nothing to change, hand off again and say why."
  );
}

export function editorSkill(
  deps: EditorSkillDeps,
  cardId: (ctx: { flowId: string | null; runId: string }) => string,
) {
  // cmt's comments family (comments.list, comments.reply) answers a batch of comments, in either mode.
  const families = deps.capabilities ? ['comments'] : ['captions', 'comments', ...(deps.families ?? [])];
  // gfx's graphics tools (editor-graphics.ts).
  const edits = [...REQUEST_TOOL_NAMES, ...EDITOR_GRAPHICS_TOOLS];
  return defineSkill({
    id: 'timeline.editor',
    // 2.1 (FIX-TRIM): timeline.slipClip. 2.2 (FIX-CMT): a comment batch is a request. 2.3 (HFW1): graphics.design
    // replaces graphics.create and graphics.restyle. 2.4 (HFW1 retire): no text item has a kit shape; a graphic's
    // words are its design's (graphics.edit). 2.5 (AGT2): the make flow's finish has every tool, and takes more fixes.
    // 2.6 (AGT2): the workspace shell's tools, where the composition registers them. 2.7 (EAR1-A3): audio.listen
    // and audio.critique, where registered.
    version: '2.8.0',
    labelKey: 'skills.timeline.editor',
    // The step loads the tools that best match this plus the request: words the tools share (timeline, graphics, text,
    // colour) would load the same few for every request, so it names what the Editor reads (timeline.get) and no more.
    // "Reads", "clips" and "ids" also matched comments.list, which then took a slot on every request.
    description:
      "Gets the timeline and its locks, then does what the editor's chat says, or finishes an assembled video.",
    prompt: `${editorPrompt()}\n\n${EDITOR_EDITS_PROMPT}`,
    // QA's command fixes name their command; each has a tool of the same name (the captions family for caption fixes).
    tools: {
      names: [
        ...new Set([
          ...(deps.capabilities
            ? editorCapabilityTools(deps.capabilities)
            : [...SHARED_TOOL_NAMES, ...edits]),
          ...FINISH_TOOL_NAMES,
          ...['workspace.docs'].filter((name) => deps.registered?.(name) ?? false),
          'library.search',
          'library.getAsset',
          ...EDITOR_PLUGIN_TOOLS.filter((name) => deps.registered?.(name) ?? false),
          // EAR1-A3: hear a sound, and score the mix with its fixes.
          ...['audio.listen', 'audio.critique'].filter((name) => deps.registered?.(name) ?? false),
          ...(deps.extendedTools === false
            ? WORKSPACE_SHELL_TOOLS
            : [...WORKSPACE_SHELL_TOOLS, ...WORKSPACE_COMPOSITION_TOOLS, ...AI_CONTEXT_TOOLS]
          ).filter((name) => deps.registered?.(name) ?? false),
        ]),
      ],
      families,
    },
    input: editorInputSchema,
    output: editorOutputSchema,
    // A request is read, planned in one to three calls, checked and handed off.
    limits: { expectedTurns: 4, maxTurns: 12 },
    refs: (output) => [{ entity: 'timeline', id: output.timelineId, version: output.revision }],
    async verify(output, ctx) {
      const timeline = await deps.service.read(output.timelineId);
      if (!timeline.ok)
        return ok({ verdict: 'retry', reason: `Can't read the timeline: ${timeline.error.code}.` });
      if (timeline.value.revision !== output.revision)
        return ok(retry(`The timeline is at revision ${timeline.value.revision}; hand off that.`));
      // EDT1-OPS: a docked run that changed nothing is sent back once, one send-back per run. A run that never read
      // the timeline is asked to read it: eval runs 9 and 11 answered "which clip is the dog?" from the note, which
      // lists numbers only. A run that read is told what was asked: in runs 13 and 14 the 9B read the timeline, said
      // "Clip 2 is now at the end" without calling moveClip, and handed off. The repeat goes through, since a
      // question, or a change that can't be made, is answered without one. A run that made an edit (a graphic's
      // proposal is one too) isn't sent back: told to look again, the 9B redoes its edits.
      const input = ctx?.input as EditorInput | undefined;
      const numbering = deps.numbering;
      const exportRequest =
        input?.request !== undefined &&
        /\b(export|render|download|save\s+video|4k|1080p|60\s*fps)\b/i.test(input.request);
      // The agent checks that this copy is visible; a stray output field cannot excuse an unrelated edit.
      const postCopy = output.postCaption !== undefined && asksOnlyForPostCopy(input?.request);
      if (
        numbering &&
        input?.request !== undefined &&
        !exportRequest &&
        !postCopy &&
        input.context !== undefined &&
        output.revision === input.context.revision &&
        numbering.firstAsk(ctx.runId, 'handoff')
      ) {
        const read = numbering.lastRead(ctx.runId, output.timelineId) !== undefined;
        return ok(retry(read ? unchangedReason(input.request) : UNREAD_REASON));
      }
      const off = cutsOffAnchor(timeline.value);
      if (off.length > 0)
        return ok(
          retry(
            `${off.length} cut(s) are more than a frame off their beat (clips ${off.map((cut) => cut.clipId).join(', ')}).`,
          ),
        );
      return ok({ verdict: 'pass' });
    },
    async card(output, ctx) {
      const timeline = await deps.service.read(output.timelineId);
      if (!timeline.ok) return timeline;
      const stats = timelineStats(timeline.value);
      return ok({
        type: 'timeline',
        id: cardId(ctx),
        version: 1,
        runId: ctx.runId,
        projectId: timeline.value.projectId,
        timelineId: timeline.value.id,
        revision: timeline.value.revision,
        duration: RationalTime.of(stats.frames, timeline.value.canvas.rate),
        clipCount: stats.clipCount,
      });
    },
  });
}
