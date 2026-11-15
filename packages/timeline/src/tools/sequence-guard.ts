// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LYR1: texts the reference shows in turn at one place (words one at a time, lines one after another) stay that way
 * in a made video. The breakdown keeps each as its own overlay and assembly copies each with its timing; what broke
 * the owner's video was the edit after: three text items were rewritten as speech segments, the first six seconds
 * long, where the reel had nine words in turn. So `timeline.editText` refuses a change of time or length that lays
 * one of a sequence's texts over another's turn, and says what the reference did.
 *
 * The rule is the template's own (templates' `templateTextSequences`, the breakdown's rule on the stored overlays),
 * read from the timeline's template: nothing here knows what kind of text it is. The others' turns are where their
 * items are now (a text removed in the same call still has its turn: removing eight and stretching the ninth is the
 * same block). Changing the words, moving the box or retiming every text in step is not refused. In a docked run
 * the person may want exactly one block, so the refusal comes once and the same call again goes through, as the
 * pointing guard's does; in any other run it stands.
 */
import {
  err,
  ok,
  RationalTime,
  type AsyncResult,
  type Template,
  type TextTrackItem,
  type Timeline,
  type ToolEditorContext,
} from '@taalcut/core';
import { templateTextSequences } from '@taalcut/templates';
import { InvalidMove } from '../errors';
import type { TemplateReader } from '../service/templates';
import type { ClipNumbering } from './clip-refs';

/** One text item's change of time, as timeline.editText's payload gives it. */
export interface TextRetime {
  readonly itemId: string;
  readonly start?: RationalTime | undefined;
  readonly duration?: RationalTime | undefined;
  readonly remove?: boolean | undefined;
}

/** A text covers another's turn when it is on for at least this share of it. */
const COVERS = 0.5;

const overlayOf = (item: TextTrackItem) =>
  item.type === 'text' ? item.overlayId : (item.overlay?.id ?? null);

/**
 * What the edits do to a sequence of the template's, in the reference's terms: null when every text keeps its turn.
 * `template` is the timeline's own.
 */
export function sequenceBreak(
  timeline: Timeline,
  template: Pick<Template, 'text' | 'canvas'>,
  edits: readonly TextRetime[],
): string | null {
  const sequences = templateTextSequences(template);
  if (sequences.length === 0) return null;
  const rate = timeline.canvas.rate;
  const frames = (time: RationalTime) => RationalTime.rescale(time, rate, 'round').value;
  const seconds = (count: number, of: Template['canvas']['rate']) => (count * of.den) / of.num;
  const items = new Map<string, TextTrackItem>();
  for (const track of timeline.tracks) {
    if (track.kind !== 'text') continue;
    for (const item of track.items) {
      const overlayId = overlayOf(item);
      if (overlayId) items.set(overlayId, item);
    }
  }
  const editOf = new Map<string, TextRetime>();
  for (const edit of edits) editOf.set(edit.itemId, { ...editOf.get(edit.itemId), ...edit });
  for (const sequence of sequences) {
    const turns = sequence.ids.flatMap((id, at) => {
      const item = items.get(id);
      if (!item) return [];
      const edit = editOf.get(item.id);
      const retimed =
        edit !== undefined && !edit.remove && (edit.start !== undefined || edit.duration !== undefined);
      const start = retimed && edit.start ? frames(edit.start) : item.start.value;
      const length = retimed && edit.duration ? Math.max(1, frames(edit.duration)) : item.duration.value;
      return [{ at, retimed, start, end: start + length }];
    });
    for (const turn of turns) {
      if (!turn.retimed) continue;
      const covered = turns.filter((other) => {
        if (other === turn) return false;
        const shared = Math.min(turn.end, other.end) - Math.max(turn.start, other.start);
        return shared >= (other.end - other.start) * COVERS;
      });
      if (covered.length === 0) continue;
      const count = sequence.ids.length;
      const templateRate = template.canvas.rate;
      const each = sequence.frames.reduce((sum, length) => sum + length, 0) / Math.max(1, count);
      return (
        `This is text ${turn.at + 1} of the ${count} the reference shows in turn at one place, about ` +
        `${seconds(each, templateRate).toFixed(1)} s each (${seconds(sequence.start, templateRate).toFixed(2)}–` +
        `${seconds(sequence.end, templateRate).toFixed(2)} s). This change would keep it on screen over ` +
        `${covered.length === 1 ? "another one's turn" : `the turns of ${covered.length} others`}: ` +
        `${seconds(turn.end - turn.start, rate).toFixed(1)} s where the reference gives each its own turn. ` +
        'Keep one text item for each turn, at its own time and length, and change its words only.'
      );
    }
  }
  return null;
}

/** timeline.editText's payload, as far as the guard reads it. */
interface EditTextPayload extends Partial<TextRetime> {
  readonly timelineId?: unknown;
  readonly edits?: readonly TextRetime[] | undefined;
}

/** Refuses an edit that turns a sequence's text into a block over the others' turns; ok otherwise. */
export async function guardSequence(
  payload: EditTextPayload,
  ctx: { readonly editor?: ToolEditorContext | undefined; readonly runId?: string | undefined },
  deps: {
    readonly service?: { read(id: Timeline['id']): AsyncResult<Timeline> };
    readonly templates?: Pick<TemplateReader, 'read'>;
    readonly numbering?: ClipNumbering;
  },
): AsyncResult<void> {
  if (!deps.service || !deps.templates) return ok(undefined);
  const edits: TextRetime[] = [
    ...(payload.itemId !== undefined ? [{ ...payload, itemId: payload.itemId }] : []),
    ...(payload.edits ?? []),
  ];
  if (!edits.some((edit) => !edit.remove && (edit.start !== undefined || edit.duration !== undefined)))
    return ok(undefined);
  const timeline = await deps.service.read(payload.timelineId as Timeline['id']);
  if (!timeline.ok || !timeline.value.template) return ok(undefined);
  const template = await deps.templates.read(timeline.value.template);
  if (!template.ok) return ok(undefined);
  const broken = sequenceBreak(timeline.value, template.value, edits);
  if (!broken) return ok(undefined);
  // In a docked run the person may have asked for one block: refused once, the same call again goes through.
  if (ctx.editor && ctx.runId !== undefined) {
    if (!deps.numbering?.firstAsk(ctx.runId, 'sequence')) return ok(undefined);
    return err(
      InvalidMove(undefined, {
        detail: `${broken} Only if the person asked for one block of text, make the same call again.`,
      }),
    );
  }
  return err(InvalidMove(undefined, { detail: broken }));
}
