// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-MAKE (gate should-fix 7): after the owner's make failed a step's check, their "Try again" got "I already
 * built that video…" with no card. The next run's history only said "That request failed." under the tools that
 * had run. Now it says which step stopped and why, what the steps before it made, and that nothing was exported.
 */
import {
  CONTROL_PREFIX,
  historyMessages,
  historyTurn,
  SKILL_INPUT_NOTE,
  type ModelScript,
} from '@taalcut/agent';
import { unwrap } from '@taalcut/core';
import type { ChatMessage } from '@taalcut/models';
import { describe, expect, it } from 'vitest';
import { flowHarness } from './support/flow-harness';
import { flowScript, json, text } from './support/flow-script';
import { call } from './support/harness';

const reel = { kind: 'link' as const, url: 'https://www.instagram.com/reel/EXAMPLE123/' };

/** The flow's script, with an Editor that always hands off a revision the timeline isn't at. */
const editorMisreads: ModelScript = (request, turn) => {
  if (!/# Skill: timeline\.editor\b/.test(request.system ?? ''))
    return flowScript({ ask: false })(request, turn);
  const marker = `${CONTROL_PREFIX} ${SKILL_INPUT_NOTE}`;
  const note = request.messages.findLast((m) => m.role === 'user' && text(m).startsWith(marker));
  const input = note ? json(text(note).slice(marker.length).trim()) : {};
  return { toolCalls: [call('handOff', { timelineId: input.timelineId, revision: 99 })] };
};

const noteOf = (messages: readonly ChatMessage[]) => {
  const note = messages.find(
    (m) => m.role === 'user' && typeof m.content === 'string' && m.content.startsWith(CONTROL_PREFIX),
  );
  return note?.role === 'user' && typeof note.content === 'string' ? note.content : '';
};

describe('the history of a make that failed a check (BRK1-MAKE)', () => {
  it('says the step it stopped at and why, what was made before it, and that nothing was exported', async () => {
    const h = flowHarness({ script: editorMisreads });
    const runId = unwrap(
      await h.agent.start({
        conversationId: 'c',
        projectId: h.world.projectId,
        message: 'Copy this reel',
        start: { path: 'reference', reference: reel },
      }),
    );
    const failed = unwrap(await h.agent.wait(runId));
    expect(failed).toMatchObject({ status: 'failed', error: { code: 'agent.verify_failed' } });
    const turn = historyTurn(runId, await h.events(runId))!;
    const note = noteOf(historyMessages({ turns: [turn] }));
    // Before: only "That request failed.", which a model read as a video already built.
    expect(note).toContain(
      'That request failed at the step timeline.editor (agent.verify_failed: It is at 1.).',
    );
    expect(note).toMatch(
      /Before that: templates\.analyst made template \w+ \(version \d+\); timeline\.librarian made timeline \w+ \(version 1\)\./,
    );
    expect(note).toContain('Nothing was exported: there is no finished video.');
    expect(note).not.toContain('That request failed.');
  });

  it('adds nothing for a run that wasn’t a flow, or a flow that finished', () => {
    const turn = historyTurn('r' as never, []);
    expect(turn).toBeUndefined();
  });
});
