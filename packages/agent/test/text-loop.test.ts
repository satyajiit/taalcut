// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-MAKE, the text loop (acc's runs 8 and 9 on the owner's reel): the on-device model answered in words turn after
 * turn in the Analyst's step, until the turn or token limit, and the breakdown made nothing. Now the first text-only
 * turn gets one nudge naming the step's tools, and the third in a row ends the step with words that say what
 * happened and to try again (`agent.no_tool_calls`). A turn that calls a tool starts the count again.
 *
 * AGT1: before the step ends, one corrective note (step.corrected) says what the handoff still needs, which tools
 * return it and how to mend the last refused call; only an answer in words after it ends the step.
 */
import { CONTROL_PREFIX, SKILL_INPUT_NOTE, type ModelScript } from '@taalcut/agent';
import { unwrap } from '@taalcut/core';
import type { ModelRequest } from '@taalcut/models';
import { describe, expect, it } from 'vitest';
import { flowHarness } from './support/flow-harness';
import { flowScript, json, text } from './support/flow-script';
import { call, ofType } from './support/harness';

const reel = { kind: 'link' as const, url: 'https://www.instagram.com/reel/EXAMPLE123/' };
const analyst = (request: ModelRequest) => /# Skill: templates\.analyst\b/.test(request.system ?? '');
const WORDS = 'I don’t have a tool to fetch the reel, so I can’t break it down.';

/** The step's input, from its control note. */
function stepInput(request: ModelRequest): Record<string, unknown> {
  const marker = `${CONTROL_PREFIX} ${SKILL_INPUT_NOTE}`;
  const note = request.messages.findLast((m) => m.role === 'user' && text(m).startsWith(marker));
  return note ? json(text(note).slice(marker.length).trim()) : {};
}

function start(h: ReturnType<typeof flowHarness>) {
  return h.agent.start({
    conversationId: 'c',
    projectId: h.world.projectId,
    message: 'Copy this reel',
    start: { path: 'reference', reference: reel },
  });
}

describe('a skill step whose model only talks (BRK1-MAKE)', () => {
  it('is nudged once with its tools, corrected once, then ends after a fourth turn in words', async () => {
    const talks: ModelScript = (request, turn) =>
      analyst(request) ? { text: WORDS } : flowScript({ ask: false })(request, turn);
    const h = flowHarness({ script: talks });
    const outcome = unwrap(await h.agent.wait(unwrap(await start(h))));
    // Before: ten turns in words, then agent.turn_limit (or the token budget on a long prompt).
    expect(outcome).toMatchObject({
      status: 'failed',
      error: { code: 'agent.no_tool_calls', params: { turns: 4 } },
    });
    const asked = h.models.requests.filter(analyst);
    expect(asked).toHaveLength(4);
    const note = asked[3]!.messages.findLast((m) => m.role === 'user');
    expect(text(note!)).toMatch(/^\[Taalcut\] Your last 3 answers called no tool/);
    expect(text(note!)).toContain('It still needs');
    expect(asked[0]!.system).not.toContain("# Use this step's tools");
    for (const request of asked.slice(1)) {
      expect(request.system).toContain("# Use this step's tools");
      expect(request.system).toMatch(/only moves through its tools: handOff, templates_breakdown/);
    }
  });

  it('starts the count again after a turn that calls a tool, and the step goes on', async () => {
    // Words, the breakdown, words twice, then the handoff: never three in a row.
    const base = flowScript({ ask: false });
    let analystTurns = 0;
    const wavers: ModelScript = (request, turn) => {
      if (!analyst(request)) return base(request, turn);
      analystTurns += 1;
      if (analystTurns === 2)
        return { toolCalls: [call('templates_breakdown', { reference: stepInput(request).reference })] };
      if (analystTurns <= 4) return { text: WORDS };
      const made = request.messages
        .filter((m) => m.role === 'tool')
        .map((m) => json(text(m)))
        .findLast((r) => typeof r.templateId === 'string')!;
      return {
        toolCalls: [
          call('handOff', {
            templateId: made.templateId,
            version: made.version,
            slotCount: made.slotCount,
            unconfirmedCuts: [],
          }),
        ],
      };
    };
    const h = flowHarness({ script: wavers });
    const runId = unwrap(await start(h));
    const outcome = unwrap(await h.agent.wait(runId));
    expect(outcome.status).not.toBe('failed');
    const events = await h.events(runId);
    expect(ofType(events, 'skill.handedOff').map((e) => e.payload.skill)).toContain('templates.analyst');
    expect(analystTurns).toBe(5);
  });

  it('goes on when the model answers the corrective note with a tool call, and logs the note', async () => {
    const base = flowScript({ ask: false });
    let analystTurns = 0;
    const corrected: ModelScript = (request, turn) => {
      if (!analyst(request)) return base(request, turn);
      analystTurns += 1;
      if (analystTurns <= 3) return { text: WORDS };
      if (analystTurns === 4)
        return { toolCalls: [call('templates_breakdown', { reference: stepInput(request).reference })] };
      const made = request.messages
        .filter((m) => m.role === 'tool')
        .map((m) => json(text(m)))
        .findLast((r) => typeof r.templateId === 'string')!;
      return {
        toolCalls: [
          call('handOff', {
            templateId: made.templateId,
            version: made.version,
            slotCount: made.slotCount,
            unconfirmedCuts: [],
          }),
        ],
      };
    };
    const h = flowHarness({ script: corrected });
    const runId = unwrap(await start(h));
    const outcome = unwrap(await h.agent.wait(runId));
    expect(outcome.status).not.toBe('failed');
    const events = await h.events(runId);
    const notes = ofType(events, 'step.corrected');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.payload).toMatchObject({ textTurns: 3, missing: expect.arrayContaining(['templateId']) });
    expect(notes[0]!.payload.tools).toContain('templates.breakdown');
    expect(ofType(events, 'skill.handedOff').map((e) => e.payload.skill)).toContain('templates.analyst');
  });
});
