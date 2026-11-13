// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V15 "Done when": the 10 timestamp prompt fixtures act on the right slot. Each prompt goes through the real
 * agent with the pointer resolver composed: the message is parsed and resolved against the conversation's
 * template and timeline (made by an earlier run), the note reaches the model, and a scripted model that acts
 * on the note's ids calls the tool. The test checks the call names the slot or clip the words meant.
 */
import { unwrap } from '@taalcut/core';
import { createMemoryEventLogStore } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { harness, ofType } from '../support/harness';
import { actOnNote, resolverFor, seedFlow, templateReads, timelineEdits, type Act } from './stand-ins';
import { videos } from './videos';

const v = videos();
const slots = v.slotIds;
const clips = v.clipIds;

interface Fixture {
  readonly prompt: string;
  readonly act: Act;
  /** The call the words mean, or the reply's gist when nothing should be called. */
  readonly expected: { readonly tool: string; readonly input: Record<string, unknown> } | RegExp;
}

const onTheirClip: (tool: string, extra: Record<string, unknown>) => Act = (tool, extra) => (lines) => {
  const line = lines.find((l) => l.found);
  if (!line) return 'I could not find that.';
  const clipId = line.basis === 'timeline' ? line.clipId : line.theirClipId;
  const timelineId = line.basis === 'timeline' ? line.timelineId : line.theirTimelineId;
  return { tool, args: { timelineId, clipId, ...extra } };
};
const onSlot: (tool: string) => Act = (tool) => (lines) => {
  const line = lines.find((l) => l.found && l.basis === 'timeline');
  return line
    ? { tool, args: { timelineId: line.timelineId, slotId: line.slotId } }
    : 'I could not find that.';
};
const copyTransition: Act = (lines) => {
  const line = lines.find((l) => l.found);
  const kind = line && /transition: (\w+)/.exec(line.text)?.[1];
  return line && kind
    ? {
        tool: 'timeline.setTransition',
        args: { timelineId: line.theirTimelineId, clipId: line.theirClipId, kind },
      }
    : 'No transition there.';
};
const readSlot: Act = (lines) => {
  const line = lines.find((l) => l.found && l.basis === 'template');
  return line
    ? { tool: 'templates.slotAt', args: { templateId: line.templateId, index: line.slotNumber } }
    : 'No reference.';
};
const sayWhatIsMissing: Act = (lines) =>
  lines.find((l) => !l.found)?.text.replace(/^- /, '') ?? 'Done, I guessed.';

const T = v.timeline.id;
/** Shorter at the end by this many frames of the 30 fps canvas: core's trim payload, in RationalTime. */
const shorterBy = (frames: number) => ({
  edge: 'end' as const,
  by: { value: -frames, rate: { num: 30, den: 1 } },
});
const FIXTURES: readonly Fixture[] = [
  {
    prompt: 'Copy the transition at 0:04',
    act: copyTransition,
    expected: { tool: 'timeline.setTransition', input: { timelineId: T, clipId: clips[2], kind: 'whip' } },
  },
  {
    prompt: 'Make slot 3 shorter',
    act: onTheirClip('timeline.trimClip', shorterBy(60)),
    expected: { tool: 'timeline.trimClip', input: { timelineId: T, clipId: clips[2], ...shorterBy(60) } },
  },
  {
    prompt: 'The third shot is too dark',
    act: onTheirClip('timeline.adjustClip', { brightness: 0.2 }),
    expected: { tool: 'timeline.adjustClip', input: { timelineId: T, clipId: clips[2], brightness: 0.2 } },
  },
  {
    prompt: 'Cambia el clip del segundo 8',
    act: onSlot('timeline.swapClip'),
    expected: { tool: 'timeline.swapClip', input: { timelineId: T, slotId: slots[3] } },
  },
  {
    prompt: 'Swap the hook',
    act: onSlot('timeline.swapClip'),
    expected: { tool: 'timeline.swapClip', input: { timelineId: T, slotId: slots[0] } },
  },
  {
    prompt: 'O terceiro corte está lento demais, encurta',
    act: onTheirClip('timeline.trimClip', shorterBy(45)),
    expected: { tool: 'timeline.trimClip', input: { timelineId: T, clipId: clips[2], ...shorterBy(45) } },
  },
  {
    prompt: 'तीसरा शॉट हटा दो',
    act: onSlot('timeline.dropSlot'),
    expected: { tool: 'timeline.dropSlot', input: { timelineId: T, slotId: slots[2] } },
  },
  {
    prompt: 'Trim my video from 0:07 to 0:08',
    act: onTheirClip('timeline.trimClip', shorterBy(30)),
    expected: { tool: 'timeline.trimClip', input: { timelineId: T, clipId: clips[3], ...shorterBy(30) } },
  },
  {
    prompt: 'In the reference, what happens at 0:10?',
    act: readSlot,
    expected: { tool: 'templates.slotAt', input: { templateId: v.template.id, index: 6 } },
  },
  {
    prompt: 'Make slot 9 punchier',
    act: sayWhatIsMissing,
    expected: /their video has 6 slots, so there is no slot 9/,
  },
];

/** A chip naming the hook slot: the template is known from it, with no earlier run. */
const hookChip = { kind: 'slot' as const, templateId: v.template.id, slotId: slots[0]! };

async function run(fixture: Fixture, options: { readonly chipOnly?: boolean } = {}) {
  const store = createMemoryEventLogStore();
  const earlier = options.chipOnly ? undefined : await seedFlow(store, v);
  const h = harness({
    script: actOnNote(fixture.act),
    modules: [timelineEdits(), templateReads()],
    store,
    deps: { phase3: { pointers: resolverFor(v) } },
  });
  const outcome = unwrap(
    await h.agent.run({
      conversationId: 'c',
      message: fixture.prompt,
      ...(earlier ? { earlierRuns: [earlier] } : { selections: [hookChip] }),
    }),
  );
  const events = await h.events(outcome.runId);
  const calls = ofType(events, 'tool.requested')
    .filter((e) => !e.payload.meta)
    .map((e) => ({ tool: e.payload.tool, input: e.payload.input }));
  return { h, outcome, events, calls };
}

describe('the 10 timestamp prompt fixtures act on the right slot', () => {
  it.each(FIXTURES.map((fixture) => [fixture.prompt, fixture] as const))('%s', async (_prompt, fixture) => {
    const { h, outcome, events, calls } = await run(fixture);
    expect(outcome.status).toBe('completed');
    const started = ofType(events, 'run.started')[0]?.payload;
    expect(started?.pointers?.length).toBeGreaterThan(0);
    // The note is in the first prompt, as a control message the model reads.
    const first = h.models.requests[0]?.messages.map((m) =>
      m.role === 'user' && typeof m.content === 'string' ? m.content : '',
    );
    expect(first?.some((text) => text.startsWith('[Taalcut] The user pointed at:'))).toBe(true);
    if (fixture.expected instanceof RegExp) {
      expect(calls).toEqual([]);
      expect(outcome.report).toMatch(fixture.expected);
      expect(started?.pointers?.[0]?.kind).toBe('unresolved');
      return;
    }
    expect(calls).toEqual([fixture.expected]);
    expect(ofType(events, 'tool.failed')).toEqual([]);
  });

  it('a replay rebuilds the same note from the log and makes the same call', async () => {
    // No earlier run (a replay has no conversation history to rebuild): the chip names the template.
    const { h, outcome, events, calls } = await run(FIXTURES[8]!, { chipOnly: true });
    expect(calls).toEqual([FIXTURES[8]!.expected]);
    expect(ofType(events, 'run.started')[0]?.payload.pointers?.[0]).toMatchObject({ slotNumber: 6 });
    const report = unwrap(await h.agent.replay(outcome.runId));
    expect(report.promptDrift).toBe(0);
    expect(report.toolCalls.map((c) => c.tool)).toEqual(['templates.slotAt']);
  });

  it('a message that points at nothing logs no pointers', async () => {
    const { events } = await run({ ...FIXTURES[1]!, prompt: 'Make it punchier' });
    expect(ofType(events, 'run.started')[0]?.payload).not.toHaveProperty('pointers');
  });
});
