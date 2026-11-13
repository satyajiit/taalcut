// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-CMT: a batch of comments through the real Editor, its real tools and the library's comments, as "Send N comments
 * to Taalcut" runs it. On the owner's run the batch's Editor had no request, so it ran as the make flow's finish:
 * slipClip and the graphics tools were withheld, findTools couldn't load them, and it answered "those editing controls
 * aren't available". Here a comment like the owner's (made-up words) is a slip on the commented clip, answered.
 */
import { createScriptedModelClient, type ScriptedReply } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { EDIT_CASES } from '../../src/edit/cases';
import { runCase } from '../../src/edit/run';
import { fixedId } from '../../src/edit/ids';
import { IDS, PROJECT_ID, TIMELINE_ID } from '../../src/edit/timeline-doc';

const target = { projectId: PROJECT_ID, timelineId: TIMELINE_ID };
const byId = (id: string) => EDIT_CASES.find((edit) => edit.id === id)!;
const call = (name: string, args: Record<string, unknown>): ScriptedReply => ({ toolCalls: [{ name, arguments: args }] });
const comment = (n: number) => fixedId<'TimelineComment'>('01K8EK', n);
const DOG = IDS.clips[4]!;

function editor(...replies: ScriptedReply[]) {
  return createScriptedModelClient((_request, turn) => replies[Math.min(turn, replies.length - 1)]!);
}

const offered = (model: ReturnType<typeof editor>, turn = 0) =>
  (model.requests[turn]?.tools ?? []).map((tool) => tool.name);

describe('comments sent together, through the real Editor (FIX-CMT)', () => {
  it('slips the commented clip earlier for "start a bit earlier, it ends badly", and answers the comment', async () => {
    for (const part of [{ seconds: -1 }, { avoid: ['end'] }]) {
      const model = editor(
        call('timeline_get', { timelineId: TIMELINE_ID }),
        call('timeline_slipClip', { ...target, clip: 'this', part }),
        call('comments_reply', { commentId: comment(1), reply: 'The dog clip starts earlier now.', status: 'resolved', changed: [DOG] }),
        call('handOff', { timelineId: TIMELINE_ID, revision: 4 }),
        { text: 'Done.' },
      );
      const { run } = await runCase(byId('comment-slip-earlier'), { live: model });
      expect(run, JSON.stringify(part)).toMatchObject({ pass: true, outOfTarget: [], malformed: [], status: 'completed' });
      expect(run.calls.map((entry) => `${entry.tool}${entry.ok ? '' : ` ✗ ${entry.error}`}`)).toEqual([
        'timeline.get',
        'timeline.slipClip',
        'comments.reply',
        'handOff',
      ]);
      // Its first turn already has the slip and the reply: the step is found by the comment's words.
      expect(offered(model)).toEqual(expect.arrayContaining(['timeline_get', 'timeline_slipClip', 'comments_reply']));
      expect(offered(model)).not.toContain('templates_styleProfile');
    }
  });

  it('offers graphics.edit on the first turn for a comment on a graphic', async () => {
    const model = editor(
      call('graphics_edit', { ...target, revision: 3, itemId: fixedId('01K8EG', 1), params: { title: 'First morning' } }),
      call('comments_reply', { commentId: comment(1), reply: 'It says First morning now.', status: 'resolved' }),
      call('handOff', { timelineId: TIMELINE_ID, revision: 4 }),
      { text: 'Done.' },
    );
    const { run } = await runCase(byId('comment-graphic-words'), { live: model });
    expect(offered(model)).toEqual(expect.arrayContaining(['graphics_edit', 'comments_reply']));
    expect(run).toMatchObject({ pass: true, outOfTarget: [], malformed: [] });
  });

  it('loads each comment case’s tools on its first turn, with timeline.get and the reply, and not the wrong kind’s', async () => {
    const needs: Record<string, readonly string[]> = {
      'comment-slip-earlier': ['timeline_slipClip'],
      'comment-two-speed-title': ['timeline_setSpeed', 'timeline_editText'],
      'comment-mute-waves': ['audio_setVolume'],
      'comment-video-warmer': ['timeline_setGrade'],
      'comment-graphic-words': ['graphics_edit'],
    };
    // Never offered: the whole-video trim for a clip's comment, a caption's words for a comment on the title.
    const never: Record<string, readonly string[]> = {
      'comment-slip-earlier': ['timeline_trimToDuration'],
      'comment-two-speed-title': ['captions_editText'],
    };
    const cases = EDIT_CASES.filter((edit) => edit.comments);
    expect(cases.map((edit) => edit.id).sort()).toEqual(Object.keys(needs).sort());
    const missing: string[] = [];
    for (const edit of cases) {
      const model = editor(call('handOff', { timelineId: TIMELINE_ID, revision: 3 }), { text: 'Done.' });
      await runCase(edit, { live: model });
      const lost = [...needs[edit.id]!, 'timeline_get', 'comments_reply'].filter((name) => !offered(model).includes(name));
      if (lost.length > 0) missing.push(`${edit.id}: ${lost.join(', ')} (offered ${offered(model).join(', ')})`);
      const extra = (never[edit.id] ?? []).filter((name) => offered(model).includes(name));
      if (extra.length > 0) missing.push(`${edit.id} offers ${extra.join(', ')}`);
    }
    expect(missing).toEqual([]);
  });

  it('fails a batch that left its comment unanswered, and one that changed another clip', async () => {
    const unanswered = editor(
      call('timeline_slipClip', { ...target, clip: 'this', part: { seconds: -1 } }),
      call('handOff', { timelineId: TIMELINE_ID, revision: 4 }),
      { text: 'Done.' },
    );
    const quiet = (await runCase(byId('comment-slip-earlier'), { live: unanswered })).run;
    expect(quiet.pass).toBe(false);
    expect(quiet.why).toMatch(/^comment 1 is open, unanswered/);
    // Clip 4 is the waves, not the commented dog: the pointing guard refuses it once, the repeat goes through.
    const elsewhere = editor(
      call('timeline_get', { timelineId: TIMELINE_ID }),
      call('timeline_slipClip', { ...target, clip: 4, part: { seconds: -1 } }),
      call('timeline_slipClip', { ...target, clip: 4, part: { seconds: -1 } }),
      call('comments_reply', { commentId: comment(1), reply: 'Done.', status: 'resolved' }),
      call('handOff', { timelineId: TIMELINE_ID, revision: 4 }),
      { text: 'Done.' },
    );
    const wrong = (await runCase(byId('comment-slip-earlier'), { live: elsewhere })).run;
    expect(wrong.calls[1]).toMatchObject({ tool: 'timeline.slipClip', ok: false, error: 'timeline.invalid_move' });
    expect(wrong.pass).toBe(false);
  });
});
