// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: one write tool per editor command (core EDITOR_COMMANDS and AUDIO_EDIT_COMMANDS), named like it. The
 * input takes seconds (editor-json.ts) and becomes the command's payload (editor-payloads.ts); the command refuses
 * agent edits on locked clips and keeps the beats; each call is one undo step. Tools that make an item answer its id.
 */
import {
  defineToolModule,
  err,
  ok,
  upgradeTimeline,
  type AnyTool,
  type AsyncResult,
  type Timeline,
  type TimelineStore,
  type ToolContextBase,
  type ToolModule,
} from '@taalcut/core';
import type { z } from 'zod';
import { InvalidMove } from '../errors';
import { videoItems } from '../model/sequence';
import type { TimelineService } from '../service/service';
import { mendClipFields, mendSlipFields } from './clip-mend';
import { guardPointing } from './pointing-guard';
import {
  clipWithShot,
  clipNumberingOf,
  createClipNumbering,
  everyClip,
  idsOnly,
  oneClipId,
  resolveClipRefs,
  type ClipNumbering,
  type ClipRef,
  type ClipRefScope,
} from './clip-refs';
import { editCommandTool } from './edit-command-tool';
import { createWholeVideoGuard, type GuardedChange, type WholeVideoGuard } from './editor-guard';
import { editorInputs, madeToolOutputSchema, type EditorToolName } from './editor-json';
import { editorPayload, type ResolvedInput } from './editor-payloads';
import type { ShotDescriptions } from './rerank-material';

/**
 * What an editor tool reads: the timeline, for an input that names its clips by number or "this", or leaves its
 * item to it; what the shots show, for a refusal that lists the clips; the clips' numbering it has seen.
 */
import { EDITOR_TOOLS } from './editor-tool-descriptions';

export interface EditorToolDeps {
  readonly service?: Pick<TimelineService, 'read'>;
  readonly shotDescriptions?: ShotDescriptions;
  readonly numbering?: ClipNumbering;
}

type RemoveInput = ResolvedInput<'timeline.removeTransition'>;

/** removeTransition without transitionId or clipId: the video's only transition, or why there isn't one. */
async function withOnlyTransition(input: RemoveInput, deps: EditorToolDeps): AsyncResult<RemoveInput> {
  if (input.transitionId !== undefined || input.clipId !== undefined) return ok(input);
  const refused = (detail: string) => err(InvalidMove(undefined, { detail }));
  if (!deps.service) return refused('Give transitionId or clipId');
  const timeline = await deps.service.read(input.timelineId);
  if (!timeline.ok) return timeline;
  const transitions = videoItems(timeline.value).filter((item) => item.type === 'transition');
  if (transitions.length === 1) return ok({ ...input, transitionId: transitions[0]!.id });
  return refused(
    transitions.length === 0
      ? 'The video has no transitions to take out.'
      : `The video has ${transitions.length} transitions: give the transitionId of the one to take out, from timeline.get's transitions.`,
  );
}

type GradeInput = ResolvedInput<'timeline.setGrade'>;
type VolumeInput = ResolvedInput<'audio.setVolume'>;
type InsertInput = ResolvedInput<'timeline.insertClip'>;

/** The tools whose clip is one `clip` (a number or "this") or `clipId`. */
const ONE_CLIP: ReadonlySet<EditorToolName> = new Set([
  'timeline.splitClip',
  'timeline.deleteClip',
  'timeline.duplicateClip',
  'timeline.setSpeed',
  'timeline.setTransition',
  'timeline.removeTransition',
  'timeline.slipClip',
]);

type Refs = { clip?: ClipRef; revision?: number };

/**
 * The input with its clips as ids, as the commands take them (clip-refs.ts): a number, "this", "next" or "previous"
 * becomes the clip's id; an id goes through.
 */
async function withClipIds(
  name: EditorToolName,
  input: Record<string, unknown>,
  ctx: ToolContextBase,
  deps: EditorToolDeps,
): AsyncResult<Record<string, unknown>> {
  const { clip, ...rest } = input as Refs & Record<string, unknown>;
  const revision = rest.revision;
  const read = async () => {
    if (!deps.service) return err(InvalidMove(undefined, { detail: 'Give the clip’s id.' }));
    const timeline = await deps.service.read(input.timelineId as Timeline['id']);
    if (!timeline.ok) return timeline;
    const scope: ClipRefScope = {
      timeline: timeline.value,
      editor: ctx.editor,
      revision,
      describe: deps.shotDescriptions,
      numbering: deps.numbering,
      runId: ctx.runId,
    };
    return ok(scope);
  };
  const ids = async (refs: readonly ClipRef[]): AsyncResult<string[]> => {
    const given = idsOnly(refs);
    if (given) return ok(given);
    const scope = await read();
    return scope.ok ? resolveClipRefs(refs, scope.value) : scope;
  };
  const one = async (ref: ClipRef): AsyncResult<string> => {
    const given = idsOnly([ref]);
    if (given) return ok(given[0]!);
    const scope = await read();
    return scope.ok ? oneClipId({ clip: ref }, scope.value) : scope;
  };
  if (ONE_CLIP.has(name)) {
    // removeTransition may name no clip: its transitionId, or the video's only transition (withOnlyTransition).
    if (clip === undefined) return ok(rest);
    const id = await one(clip);
    return id.ok ? ok({ ...rest, clipId: id.value }) : id;
  }
  if (name === 'timeline.setGrade') {
    const { clips, ...grade } = rest as { clips?: ClipRef[] };
    if (clips === undefined) return ok(grade);
    const resolved = await ids(clips);
    return resolved.ok ? ok({ ...grade, clipIds: resolved.value }) : resolved;
  }
  if (name === 'audio.setVolume') {
    const of = rest.of as { kind: string; clips?: ClipRef[] };
    if (of.kind !== 'clips' || of.clips === undefined) return ok(rest);
    const resolved = await ids(of.clips);
    return resolved.ok ? ok({ ...rest, of: { kind: 'clips', clipIds: resolved.value } }) : resolved;
  }
  if (name === 'timeline.insertClip') {
    const position = rest.position as { kind: string; clip?: ClipRef };
    if (position.clip === undefined) return ok(rest);
    const id = await one(position.clip);
    return id.ok ? ok({ ...rest, position: { kind: position.kind, itemId: id.value } }) : id;
  }
  return ok(rest);
}

/**
 * The guard in a docked run (editor-guard.ts): a grade with no clips, a volume change on every clip, without
 * wholeVideo; an insert of a shot the video already has. Nothing to guard without the timeline or outside a docked
 * run.
 */
async function guarded(
  name: EditorToolName,
  input: unknown,
  ctx: ToolContextBase,
  deps: EditorToolDeps,
  guard: WholeVideoGuard,
): AsyncResult<void> {
  if (!ctx.editor || !deps.service) return ok(undefined);
  let kind: GuardedChange['kind'] | null = null;
  if (name === 'timeline.setGrade') {
    const grade = input as GradeInput;
    if (grade.clipIds === undefined && grade.wholeVideo !== true) kind = 'colour';
  } else if (name === 'audio.setVolume') {
    const volume = input as VolumeInput;
    if (volume.of.kind === 'clips' && volume.wholeVideo !== true) kind = 'sound';
  } else if (name === 'timeline.insertClip') {
    if ((input as InsertInput).media.kind === 'video') kind = 'insert';
  }
  if (kind === null) return ok(undefined);
  const timeline = await deps.service.read((input as { timelineId: Timeline['id'] }).timelineId);
  if (!timeline.ok) return ok(undefined);
  const change: GuardedChange = { kind, runId: ctx.runId, editor: ctx.editor, timeline: timeline.value };
  if (
    kind === 'sound' &&
    !everyClip(timeline.value, (input as VolumeInput & { of: { clipIds: string[] } }).of.clipIds)
  )
    return ok(undefined);
  if (kind === 'insert') {
    const media = (input as InsertInput).media as { shotId: string | null };
    const sameShot = clipWithShot(timeline.value, media.shotId);
    if (!sameShot) return ok(undefined);
    return guard.check({ ...change, sameShot });
  }
  return guard.check(change);
}

function toolsOf(prefix: 'timeline.' | 'audio.', deps: EditorToolDeps): AnyTool[] {
  const guard = createWholeVideoGuard();
  const withNumbering = { ...deps, numbering: deps.numbering ?? createClipNumbering() };
  return EDITOR_TOOLS.filter((text) => text.command.startsWith(prefix)).map((text) =>
    editCommandTool({
      ...text,
      service: deps.service,
      input: editorInputs[text.command] as z.ZodType,
      output: madeToolOutputSchema,
      // `clipId` and `clipIds` from an older caller, as `clip` and `clips` (clip-mend.ts).
      mendInput: text.command === 'timeline.slipClip' ? mendSlipFields : mendClipFields,
      payload: async (raw, _artifacts, ctx) => {
        const resolved = await withClipIds(text.command, raw as Record<string, unknown>, ctx, withNumbering);
        if (!resolved.ok) return resolved;
        const input = resolved.value;
        const allowed = await guarded(text.command, input, ctx, withNumbering, guard);
        if (!allowed.ok) return allowed;
        // EDT1-OPS: a change away from what the person pointed at, refused once (pointing-guard.ts).
        const pointing = await guardPointing(
          text.command,
          input as Record<string, unknown>,
          raw as Record<string, unknown>,
          ctx,
          withNumbering,
        );
        if (!pointing.ok) return pointing;
        if (text.command !== 'timeline.removeTransition')
          return ok(editorPayload(text.command, input as never));
        const filled = await withOnlyTransition(input as RemoveInput, withNumbering);
        return filled.ok ? ok(editorPayload(text.command, filled.value)) : filled;
      },
    }),
  );
}

/** The `timeline.*` editor tools, in the `timeline` module. */
export const editorTools = (deps: EditorToolDeps = {}): AnyTool[] => toolsOf('timeline.', deps);

/**
 * The sound's edits as an `audio` module (tool names start with their module's id): the agent process joins it to
 * audio's own module of that id, as render's captureFrame joins `timeline`. With the timeline store, a change to
 * every clip's sound in a docked run is guarded (editor-guard.ts).
 */
export function audioEditToolModule(
  deps: { readonly timelines?: Pick<TimelineStore, 'get'>; readonly numbering?: ClipNumbering } = {},
): ToolModule {
  const { timelines } = deps;
  // EDT1-OPS: the timeline store's numbering, which the `timeline` module's timeline.get reads into (clip-refs.ts).
  const numbering = deps.numbering ?? (timelines ? clipNumberingOf(timelines) : undefined);
  const service: EditorToolDeps['service'] = timelines
    ? {
        async read(timelineId) {
          const stored = await timelines.get(timelineId);
          return stored.ok ? upgradeTimeline(stored.value.json, stored.value.schemaVersion) : stored;
        },
      }
    : undefined;
  return defineToolModule({
    id: 'audio',
    tools: toolsOf('audio.', { ...(service ? { service } : {}), ...(numbering ? { numbering } : {}) }),
  });
}
