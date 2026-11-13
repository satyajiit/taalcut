// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the guard on a change away from what the person pointed at, in a docked run (SPEC "The guard in a docked
 * run"). With a selection, a change to a clip that is neither selected nor one the words point at, or a transition on
 * a cut that touches neither, is refused once in the run. With nothing selected and the playhead at a cut, a transition
 * on another cut is refused the same way. The refusal names the clips by number, with what each shows fenced after it.
 * The words may still mean the other clip ("the dog", "clip 3"), so the same call again goes through. On the 9B, "add a
 * crossfade into the next one" with the bike selected went on the coffee to crossing cut (eval runs 6, 7 and 11), and
 * "add a dip to black here" at the coffee to crossing cut went on the next cut (runs 10 and 12).
 */
import { err, ok, RationalTime, type AsyncResult, type Timeline, type ToolEditorContext } from '@taalcut/core';
import { InvalidMove } from '../errors';
import { numberedClips, numberedList, pointedClips, type ClipNumbering, type NumberedClip } from './clip-refs';
import { NEAR_CUT_SECONDS } from './editor-view';
import type { ShotDescriptions } from './rerank-material';

export interface PointedChange {
  readonly timeline: Timeline;
  readonly editor: ToolEditorContext | undefined;
  readonly runId: string | undefined;
  readonly numbering: ClipNumbering | undefined;
  readonly describe: ShotDescriptions | undefined;
  /** The clips the call changes, by id. */
  readonly clipIds?: readonly string[];
  /** A transition's cut: the clips either side of it, by id. */
  readonly cut?: readonly [string, string];
  /** The call named its clip as "next" or "previous": counted from what was pointed at, so it was pointed at. */
  readonly relative?: boolean;
}

const listed = (clips: readonly NumberedClip[]) => clips.map((clip) => `clip ${clip.number}`).join(' and ');

/** The two clips either side of the cut the playhead is at (within NEAR_CUT_SECONDS), if it is at one. */
function cutAtPlayhead(clips: readonly NumberedClip[], editor: ToolEditorContext, timeline: Timeline) {
  const rate = timeline.canvas.rate;
  const at = RationalTime.rescale(editor.context.playhead, rate, 'round').value;
  const near = (NEAR_CUT_SECONDS * rate.num) / rate.den;
  for (let index = 1; index < clips.length; index++) {
    const [before, after] = [clips[index - 1]!, clips[index]!];
    if (Math.abs(at - after.start) <= near) return [before, after] as const;
  }
  return null;
}

/** What to say, and about which clips, when the change is away from what was pointed at; null when it isn't. */
function offPointing(change: PointedChange, editor: ToolEditorContext): { said: string; clips: NumberedClip[] } | null {
  const { timeline } = change;
  const clips = numberedClips(timeline);
  const byId = new Map(clips.map((clip) => [clip.id, clip]));
  const selection = pointedClips(timeline, editor, false);
  const selected = selection.by === 'selection' ? selection.clips : [];
  const words = pointedClips(timeline, editor);
  const pointed = new Set([...selected, ...(words.by === 'targets' ? words.clips : [])].map((clip) => clip.id));
  // When a pointed clip was split earlier in the run, its new halves still occupy its original span at
  // editor.context.revision, so further splits, swaps or transitions on those halves stay within what was pointed at.
  const then = change.numbering?.clipsAt?.(timeline, editor.context.revision) ?? [];
  const spans = then.filter((clip) => pointed.has(clip.id));
  if (spans.length > 0) {
    for (const clip of clips) {
      if (spans.some((span) => clip.start >= span.start && clip.end <= span.end)) pointed.add(clip.id);
    }
  }
  if (change.cut) {
    const [from, to] = change.cut.map((id) => byId.get(id));
    if (!from || !to) return null;
    // In line: a cut the selection is on, or one whose two clips the words both point at ("between the dog and the
    // skyline"). One named clip isn't enough: "into the next one" names the next clip, and its far cut isn't meant.
    const named = pointed.has(from.id) && pointed.has(to.id);
    if (named || selected.some((clip) => clip.id === from.id || clip.id === to.id)) return null;
    const cut = `the cut between clip ${from.number} and clip ${to.number}`;
    if (selected.length > 0) {
      return {
        said: `The person selected ${listed(selected)}; this transition is on ${cut}. "Into the next one" and "after this" are the selected clip's own cut: clip "this", edge "end".`,
        clips: [...selected, from, to],
      };
    }
    const here = cutAtPlayhead(clips, editor, timeline);
    if (!here || (here[0].id === from.id && here[1].id === to.id)) return null;
    return {
      said: `The playhead is at the cut between clip ${here[0].number} and clip ${here[1].number}; this transition is on ${cut}. For "here", give clip ${here[0].number} with edge "end".`,
      clips: [here[0], here[1], from, to],
    };
  }
  if (selected.length === 0 || change.relative) return null;
  const off = (change.clipIds ?? []).flatMap((id) => {
    const clip = byId.get(id);
    return clip && !pointed.has(clip.id) ? [clip] : [];
  });
  if (off.length === 0) return null;
  return {
    said: `The person selected ${listed(selected)}; this changes ${listed(off)}. "This" and "it" are the selection: clip "this".`,
    clips: [...selected, ...off],
  };
}

/** Refuses, once in a docked run, a change away from what the person pointed at; ok otherwise. */
export async function checkPointing(change: PointedChange): AsyncResult<void> {
  const { editor, runId } = change;
  if (!editor || runId === undefined) return ok(undefined);
  const away = offPointing(change, editor);
  if (!away || !change.numbering?.firstAsk(runId, 'pointing')) return ok(undefined);
  const clips = [...new Map(away.clips.map((clip) => [clip.id, clip])).values()].sort((a, b) => a.number - b.number);
  const { shows } = await numberedList(clips, change.describe);
  return err(
    InvalidMove(undefined, {
      detail: `${away.said} Only if their words name the other clip, make the same call again.${shows}`,
    }),
  );
}

/** The clips a tool's input (its clips as ids) changes, or the cut a transition is on; null when it names none. */
export function changeOf(name: string, input: Record<string, unknown>, timeline: Timeline): Pick<PointedChange, 'clipIds' | 'cut'> | null {
  if (name === 'timeline.setTransition' || name === 'timeline.removeTransition') {
    if (typeof input.clipId !== 'string') return null;
    const clips = numberedClips(timeline);
    const index = clips.findIndex((clip) => clip.id === input.clipId);
    const [from, to] = input.edge === 'start' ? [clips[index - 1], clips[index]] : [clips[index], clips[index + 1]];
    return index >= 0 && from && to ? { cut: [from.id, to.id] } : null;
  }
  if (Array.isArray(input.clipIds)) return { clipIds: input.clipIds as string[] };
  const of = input.of as { kind?: string; clipIds?: string[] } | undefined;
  if (of?.kind === 'clips' && Array.isArray(of.clipIds)) return { clipIds: of.clipIds };
  return typeof input.clipId === 'string' ? { clipIds: [input.clipId] } : null;
}

/** True when a call named its clip as "next" or "previous" (its `clip`, `clips` or `of.clips`). */
export function namesRelative(raw: Record<string, unknown>): boolean {
  const of = raw.of as { clips?: unknown } | undefined;
  const refs = [raw.clip, ...(Array.isArray(raw.clips) ? raw.clips : []), ...(Array.isArray(of?.clips) ? of.clips : [])];
  return refs.some((ref) => ref === 'next' || ref === 'previous');
}

/** The pointing guard for a tool call: its input with clips as ids, and as the model sent it. */
export async function guardPointing(
  name: string,
  input: Record<string, unknown>,
  raw: Record<string, unknown>,
  ctx: { readonly editor?: ToolEditorContext | undefined; readonly runId?: string | undefined },
  deps: {
    readonly service?: { read(id: Timeline['id']): AsyncResult<Timeline> };
    readonly numbering?: ClipNumbering;
    readonly shotDescriptions?: ShotDescriptions;
  },
): AsyncResult<void> {
  if (!ctx.editor || !deps.service) return ok(undefined);
  const timeline = await deps.service.read(input.timelineId as Timeline['id']);
  if (!timeline.ok) return ok(undefined);
  deps.numbering?.remember(timeline.value);
  const change = changeOf(name, input, timeline.value);
  if (!change) return ok(undefined);
  return checkPointing({
    timeline: timeline.value,
    editor: ctx.editor,
    runId: ctx.runId,
    numbering: deps.numbering,
    describe: deps.shotDescriptions,
    ...change,
    relative: namesRelative(raw),
  });
}
