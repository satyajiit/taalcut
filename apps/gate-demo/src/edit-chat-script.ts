// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CTX: what the stand-in model does when the editor's docked chat asks for a change (the desktop journey
 * e2e/make-flow-edit-chat.e2e.ts, on a video the make flow's reference journey made). The agent sends a docked
 * change straight to the Editor skill with the editor as the user sees it; the stand-in, as a model would:
 *
 * - Editor: read the timeline, take the clip the user selected (the message's selection note, in the messages, so
 *   its id is the canonical one) a beat shorter at its end with timeline.trimClip, hand off the new revision;
 * - main turn (the run's last): say what changed.
 *
 * The beat is the reference's (120 BPM at 30 fps: 15 frames). The journey selects the last clip, whose end no cut
 * follows, so every cut stays on its beat and the Editor's check passes.
 */
import { blockText, type AnthropicMessage, type RequestView, type ToolCall } from './anthropic-view';
import { REFERENCE_BPM, REFERENCE_RATE } from './make-flow-fixtures';
import { call, callsTo, notes, readCall, record, use, withNote, withReads } from './make-flow-reads';
import type { DemoTurn } from './script';
import { findClip } from './make-flow-editor';

/** The docked message, typed into the editor's chat with a clip selected. */
export const EDIT_CHAT_ASK = 'Make this clip shorter';
export const EDIT_CHAT_ASKS: readonly string[] = [EDIT_CHAT_ASK];
/** One beat, in frames at the canvas rate. */
export const EDIT_CHAT_BEAT_FRAMES = Math.round((REFERENCE_RATE * 60) / REFERENCE_BPM);
export const EDIT_CHAT_ANSWER =
  'Done: the clip you selected is a beat shorter. Undo all on the card puts it back.';

export const isEditChatAsk = (ask: string): boolean => EDIT_CHAT_ASKS.some((known) => ask.includes(known));

/** The clip the user selected, from the newest selection note in the messages. */
function selectedClip(messages: readonly AnthropicMessage[]): string | null {
  const text = messages
    .map((m) =>
      typeof m.content === 'string'
        ? m.content
        : m.content.map((b) => (b.type === 'text' ? (b.text ?? '') : blockText(b.content))).join('\n'),
    )
    .join('\n');
  const found = [...text.matchAll(/- clip (\S+) in timeline \S+/g)].at(-1);
  return found?.[1] ?? null;
}

export function editChatTurn(view: RequestView, messages: readonly AnthropicMessage[]): DemoTurn {
  if (view.skill !== 'timeline.editor') return { text: EDIT_CHAT_ANSWER };
  const prefix = '[stand-in trim] ';
  const state = { ...notes(view, prefix).at(-1) };
  const finish = (turn: DemoTurn) => withNote(turn, prefix + JSON.stringify(state));
  const input = record(view.input);
  const timelineId = input.timelineId;
  const trimmed = callsTo(view, 'timeline_trimClip').at(-1);
  if (trimmed) {
    const done = readCall(view, trimmed, { revision: '/revision' });
    if (done.turn) return done.turn;
    return withReads(use('handOff', { timelineId, revision: done.json.revision }), done);
  }
  const visible = callsTo(view, 'timeline_get')[0];
  if (visible && /^(?:Stored as (?:artifact|result)|\[Taalcut\] Read result) /.test(visible.result))
    state.source = visible.result.split('\n')[0];
  const got: ToolCall | undefined =
    visible ??
    (typeof state.source === 'string'
      ? { name: 'timeline_get', input: { timelineId }, result: state.source }
      : undefined);
  if (!got) return finish(call(view, 'timeline_get', { timelineId }, 'Reading the video first.'));
  if (typeof state.revision !== 'number' || !state.rate) {
    const needed = readCall(view, got, { revision: '/revision', rate: '/rate' });
    if (needed.turn) return finish(needed.turn);
    state.revision = needed.json.revision;
    state.rate = needed.json.rate;
  }
  const rate = record(state.rate);
  if (
    typeof state.revision !== 'number' ||
    !Number.isInteger(rate.num) ||
    !Number.isInteger(rate.den) ||
    Number(rate.num) <= 0 ||
    Number(rate.den) <= 0
  )
    return { text: 'I could not observe the timeline revision and frame rate for this trim.' };
  const selected = findClip(view, got, selectedClip(messages) ?? undefined);
  if (selected.turn) return finish(selected.turn);
  const clip = selected.json;
  if (!clip.clipId) return { text: 'This video has no clip to shorten.' };
  if (clip.locked || clip.userPick)
    return finish(
      use('handOff', { timelineId, revision: state.revision }, 'I kept the protected clip unchanged.'),
    );
  return finish(
    withReads(
      call(
        view,
        'timeline_trimClip',
        {
          projectId: input.projectId,
          timelineId,
          clipId: clip.clipId,
          edge: 'end',
          by: {
            value: -EDIT_CHAT_BEAT_FRAMES,
            rate: { num: rate.num, den: rate.den },
          },
        },
        'Taking a beat off the end of the clip you selected.',
      ),
      selected,
    ),
  );
}
