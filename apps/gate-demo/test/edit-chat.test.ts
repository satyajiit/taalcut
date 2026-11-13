// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CTX: the stand-in's docked change (src/edit-chat-script.ts), turn by turn: the Editor reads the timeline,
 * takes a beat off the clip the selection note names (the last clip when it names none), hands off the trim's
 * revision; the run's last turn says what changed. Its ask is its own session's, apart from the make flow's.
 */
import { describe, expect, it } from 'vitest';
import {
  EDIT_CHAT_ANSWER,
  EDIT_CHAT_ASK,
  EDIT_CHAT_BEAT_FRAMES,
  EDIT_CHAT_SESSION,
  editChatTurn,
  isEditChatAsk,
  isMakeFlowAsk,
  MAKE_FLOW_SESSION,
  type RequestView,
} from '../src/index';

const timeline = {
  revision: 7,
  rate: { num: 30, den: 1 },
  clips: [
    { clipId: 'C1', kind: 'clip' },
    { clipId: 'G1', kind: 'gap' },
    { clipId: 'C2', kind: 'clip' },
    { clipId: 'C3', kind: 'clip' },
  ],
};
const input = { projectId: 'P', timelineId: 'T', templateId: 'M' };
const view = (calls: RequestView['calls']): RequestView => ({
  ask: EDIT_CHAT_ASK,
  skill: 'timeline.editor',
  input,
  calls,
  tools: ['timeline_get', 'timeline_trimClip', 'handOff'],
});
const said = (text: string) => [{ role: 'user', content: [{ type: 'text', text }] }];

describe('the docked change’s stand-in (EDT1-CTX)', () => {
  it('reads the timeline, trims the selected clip by a beat, and hands off the new revision', () => {
    expect(editChatTurn(view([]), []).toolCall).toEqual({ name: 'timeline_get', args: { timelineId: 'T' } });
    const got = { name: 'timeline_get', input: {}, result: JSON.stringify(timeline) };
    const note = said(`${EDIT_CHAT_ASK}\n\nThe user selected:\n- clip C2 in timeline T`);
    expect(editChatTurn(view([got]), note).toolCall).toEqual({
      name: 'timeline_trimClip',
      args: {
        projectId: 'P',
        timelineId: 'T',
        clipId: 'C2',
        edge: 'end',
        by: { value: -EDIT_CHAT_BEAT_FRAMES, rate: { num: 30, den: 1 } },
      },
    });
    expect(EDIT_CHAT_BEAT_FRAMES).toBe(15);
    // No selection note: the last clip.
    expect(editChatTurn(view([got]), said(EDIT_CHAT_ASK)).toolCall?.args.clipId).toBe('C3');
    const trimmed = { name: 'timeline_trimClip', input: {}, result: JSON.stringify({ revision: 8 }) };
    expect(editChatTurn(view([got, trimmed]), note).toolCall).toEqual({
      name: 'handOff',
      args: { timelineId: 'T', revision: 8 },
    });
  });

  it('answers in words on the run’s last turn, and is its own session', () => {
    expect(editChatTurn({ ...view([]), skill: null }, [])).toEqual({ text: EDIT_CHAT_ANSWER });
    expect(isEditChatAsk(EDIT_CHAT_ASK)).toBe(true);
    expect(isMakeFlowAsk(EDIT_CHAT_ASK)).toBe(false);
    expect(EDIT_CHAT_SESSION.asks).toEqual([EDIT_CHAT_ASK]);
    expect(EDIT_CHAT_SESSION.cassette).not.toBe(MAKE_FLOW_SESSION.cassette);
  });

  it.each(['locked', 'userPick'])('preserves a selected clip marked %s', (flag) => {
    const got = {
      name: 'timeline_get',
      input: {},
      result: JSON.stringify({ ...timeline, clips: [{ clipId: 'C2', kind: 'clip', [flag]: true }] }),
    };
    const note = said(`${EDIT_CHAT_ASK}\n\nThe user selected:\n- clip C2 in timeline T`);
    expect(editChatTurn(view([got]), note).toolCall).toEqual({
      name: 'handOff',
      args: { timelineId: 'T', revision: 7 },
    });
  });

  it('does not fabricate a frame rate when the required field was not observed', () => {
    const got = {
      name: 'timeline_get',
      input: {},
      result: JSON.stringify({ revision: 7, clips: timeline.clips }),
    };
    const turn = editChatTurn(view([got]), said(EDIT_CHAT_ASK));
    expect(turn.toolCall).toBeUndefined();
    expect(turn.text).toContain('could not observe');
  });
});
