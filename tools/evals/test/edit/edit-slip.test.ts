// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-TRIM: the edit eval's slip cases. An Editor that slips the clip the way each case asks passes its checker, and
 * one that slips it the wrong way fails it.
 */
import { createScriptedModelClient, type ScriptedReply } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { EDIT_CASES } from '../../src/edit/cases';
import { runCase } from '../../src/edit/run';
import { PROJECT_ID, TIMELINE_ID } from '../../src/edit/timeline-doc';

const target = { projectId: PROJECT_ID, timelineId: TIMELINE_ID };
const byId = (id: string) => EDIT_CASES.find((edit) => edit.id === id)!;
const call = (name: string, args: Record<string, unknown>): ScriptedReply => ({
  toolCalls: [{ name, arguments: args }],
});

function editor(name: string, args: Record<string, unknown>) {
  const replies: ScriptedReply[] = [
    call('timeline_get', { timelineId: TIMELINE_ID }),
    call(name, { ...target, ...args }),
    { text: 'Done.', ...call('handOff', { timelineId: TIMELINE_ID, revision: 4 }) },
    { text: 'Done.' },
  ];
  return createScriptedModelClient((_request, turn) => replies[Math.min(turn, replies.length - 1)]!);
}

describe('the slip cases (FIX-TRIM)', () => {
  it.each([
    ['slip-start-this', { clip: 'this', part: { avoid: ['start'] } }],
    ['slip-later-seconds', { clip: 4, part: { seconds: 2 } }],
    ['slip-face-this', { clip: 'this', part: { avoid: ['face'] } }],
    ['slip-end-named', { clip: 5, part: { avoid: ['end'] } }],
  ])('%s passes a slip', async (id, args) => {
    const { run } = await runCase(byId(id), { live: editor('timeline_slipClip', args) });
    expect(run).toMatchObject({ pass: true, outOfTarget: [], malformed: [], status: 'completed' });
  });

  it('fails a slip the wrong way: earlier for a slow start', async () => {
    const earlier = editor('timeline_slipClip', { clip: 'this', part: { seconds: -1 } });
    const { run } = await runCase(byId('slip-start-this'), { live: earlier });
    expect(run.pass).toBe(false);
  });
});
