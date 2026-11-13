// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createScriptedModelClient, type ScriptedReply } from '@taalcut/agent';
import { expect, it } from 'vitest';
import { EDIT_CASES } from '../../src/edit/cases';
import { clipNo, speedOf } from '../../src/edit/check';
import { loadSession } from '../../src/edit/cli';
import { runCase } from '../../src/edit/run';
import { PROJECT_ID, TIMELINE_ID } from '../../src/edit/timeline-doc';

const target = { projectId: PROJECT_ID, timelineId: TIMELINE_ID };
const edit = EDIT_CASES.find((entry) => entry.id === 'multi-fast-warm')!;
const call = (name: string, args: Record<string, unknown>): ScriptedReply => ({
  toolCalls: [{ name, arguments: args }],
});

it('rejects the legacy same-revision second write without changing the grade or committing again', async () => {
  const replies = [
    call('timeline_get', { timelineId: TIMELINE_ID }),
    {
      toolCalls: [
        { name: 'timeline_setSpeed', arguments: { ...target, revision: 3, clip: '5', speed: 2 } },
        { name: 'timeline_setGrade', arguments: { ...target, revision: 3, clips: ['5'], temperature: 0.6 } },
      ],
    },
    call('timeline_get', { timelineId: TIMELINE_ID }),
    call('handOff', { timelineId: TIMELINE_ID, revision: 4 }),
  ];
  const live = createScriptedModelClient((_request, turn) => replies[Math.min(turn, replies.length - 1)]!);
  const { run } = await runCase(
    {
      ...edit,
      check(before, after, asked) {
        expect(speedOf(clipNo(after, 4))).toBe(2);
        expect(clipNo(after, 4)?.grade).toEqual(clipNo(before, 4)?.grade);
        expect(after.revision).toBe(before.revision + 1);
        return edit.check(before, after, asked);
      },
    },
    { live },
  );
  expect(run).toMatchObject({
    pass: false,
    why: 'the dog clip is no warmer',
    outOfTarget: [],
    malformed: [],
  });
  expect(run.calls.find((entry) => entry.tool === 'timeline.setGrade')).toMatchObject({
    ok: false,
    error: 'core.conflict',
    input: { revision: 3 },
  });
});

it('replays the revision-aware replacement to the unchanged intended final effect', async () => {
  const session = loadSession(edit.id)!;
  expect(session.model).toBe('scripted/EDT2 revision-aware contract');
  const { run } = await runCase(edit, { replay: session });
  expect(run).toMatchObject({ pass: true, status: 'completed', malformed: [], outOfTarget: [] });
  expect(run.calls.map((entry) => entry.tool)).toEqual([
    'timeline.get',
    'timeline.setSpeed',
    'timeline.get',
    'timeline.setGrade',
    'timeline.get',
    'handOff',
  ]);
  expect(
    run.calls.filter((entry) => entry.tool.startsWith('timeline.set')).map((entry) => entry.input),
  ).toEqual([expect.objectContaining({ revision: 3 }), expect.objectContaining({ revision: 4 })]);
});
