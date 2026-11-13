// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V13, agent half (SPEC section 27), on compositions (HFW1 retire): motion-graphics prompts become the right
 * `graphics.*` calls. A new graphic, or a new look or motion for one, is a `graphics.design` job with the person's
 * words verbatim and where it comes on, which must parse with core's `graphicsDesignJobSchema`. A change of time,
 * length or words is `graphics.edit`, a removal `graphics.remove`: each is dispatched as a command whose payload
 * must parse with core's `graphicsCommandPayloads`, as the bus parses it. Words are plain text: never markup,
 * script or a link. A prompt that names a slot ("to slot 2") is anchored to the slot the pointer note resolved.
 * Made-up words and names.
 */
import {
  GRAPHICS_COMMANDS,
  GRAPHICS_DESIGN_TOOL,
  graphicsCommandPayloads,
  graphicsDesignJobSchema,
  newId,
  RationalTime,
  unwrap,
  type GraphicsDesignJob,
} from '@taalcut/core';
import { createMemoryEventLogStore } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { harness } from '../support/harness';
import { actOnNote, resolverFor, seedFlow, type Act } from '../timestamps/stand-ins';
import { videos } from '../timestamps/videos';
import { graphicsModule } from './graphics-module';

const v = videos();
const target = { projectId: v.timeline.projectId, timelineId: v.timeline.id };
const lowerThird = newId<'TimelineItem'>();
const counter = newId<'TimelineItem'>();
const phrase = (text: string, occurrence = 1) => ({ kind: 'phrase' as const, text, occurrence });

type Command = typeof GRAPHICS_COMMANDS.edit | typeof GRAPHICS_COMMANDS.remove;
interface Fixture {
  readonly prompt: string;
  readonly tool: Command | typeof GRAPHICS_DESIGN_TOOL;
  /** What the model sends, given the pointer note's lines. */
  readonly args: (slotId: string | undefined) => Record<string, unknown>;
}

/** A new graphic: the Designer's job, the person's words as they said them. */
const designed = (prompt: string, where: Record<string, unknown>): Fixture => ({
  prompt,
  tool: GRAPHICS_DESIGN_TOOL,
  args: () => ({ request: prompt, ...where }),
});

const FIXTURES: readonly Fixture[] = [
  designed('Add a lower third "Asha Rao, Founder" when I first say hi', { phrase: 'hi' }),
  designed('Count up to 50% when I say fifty percent', { phrase: 'fifty percent' }),
  designed('Show a list of Plan, Shoot and Edit, each one when I say first, second and third', {
    phrase: 'first',
  }),
  designed('जब मैं नमस्ते कहूँ, तब लोअर थर्ड में मेरा नाम आशा राव दिखाओ', { phrase: 'नमस्ते' }),
  designed('Pon un contador hasta 30 por ciento cuando digo treinta por ciento', {
    phrase: 'treinta por ciento',
  }),
  designed('Coloque um destaque com o preço R$ 49,90 apontando para o produto no segundo 6', { at: 6 }),
  designed('Put "Ship it on Friday" up big, word by word with a bounce, when I say ship it', {
    phrase: 'ship it',
  }),
  designed('Show a chat message "Are you coming?" at the start, like a text from a friend', { at: 0 }),
  designed('Add a subscribe button for the last three seconds', { at: 7 }),
  {
    prompt: 'Make the lower third type in letter by letter and leave the way it came',
    tool: GRAPHICS_DESIGN_TOOL,
    args: () => ({
      request: 'Make the lower third type in letter by letter and leave the way it came',
      itemIds: [lowerThird],
    }),
  },
  {
    prompt: 'Make the lower third say Founder',
    tool: GRAPHICS_COMMANDS.edit,
    args: () => ({ ...target, itemId: lowerThird, params: { title: 'Founder' } }),
  },
  {
    prompt: 'Move the counter later, to when I say "double"',
    tool: GRAPHICS_COMMANDS.edit,
    args: () => ({ ...target, itemId: counter, anchor: phrase('double') }),
  },
  {
    prompt: 'Move the lower third to slot 2',
    tool: GRAPHICS_COMMANDS.edit,
    args: (slotId) => ({ ...target, itemId: lowerThird, anchor: { kind: 'slot', slotId } }),
  },
  {
    prompt: 'Keep the counter up for two and a half seconds',
    tool: GRAPHICS_COMMANDS.edit,
    args: () => ({ ...target, itemId: counter, duration: { value: 75, rate: { num: 30, den: 1 } } }),
  },
  {
    prompt: 'Remove the lower third',
    tool: GRAPHICS_COMMANDS.remove,
    args: () => ({ ...target, itemId: lowerThird }),
  },
];

/** The model: the fixture's call, anchored to the slot the note names when it names one. */
const act =
  (fixture: Fixture): Act =>
  (lines) => ({ tool: fixture.tool, args: fixture.args(lines.find((l) => l.found)?.slotId) });

/** Every string a model wrote. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

async function run(fixture: Fixture) {
  const store = createMemoryEventLogStore();
  const earlier = await seedFlow(store, v);
  const jobs: GraphicsDesignJob[] = [];
  const h = harness({
    script: actOnNote(act(fixture)),
    modules: [graphicsModule(jobs)],
    store,
    deps: { phase3: { pointers: resolverFor(v) } },
  });
  const outcome = unwrap(
    await h.agent.run({ conversationId: 'c', message: fixture.prompt, earlierRuns: [earlier] }),
  );
  return { outcome, applied: h.applied, jobs };
}

describe('motion-graphics prompts become design jobs and edits (HFW1 retire)', () => {
  it.each(FIXTURES.map((f) => [f.prompt, f] as const))('%s', async (_prompt, fixture) => {
    const { outcome, applied, jobs } = await run(fixture);
    expect(outcome.status).toBe('completed');
    const expected = fixture.args(v.slotIds[1]);
    if (fixture.tool === GRAPHICS_DESIGN_TOOL) {
      expect(applied).toEqual([]);
      expect(jobs).toHaveLength(1);
      expect(graphicsDesignJobSchema.safeParse(jobs[0]).error?.issues).toBeUndefined();
      expect(jobs[0]).toEqual(expected);
      // The person's words go to the Designer as they said them.
      expect(jobs[0]?.request).toBe(fixture.prompt);
      return;
    }
    expect(jobs).toEqual([]);
    expect(applied.map((a) => a.command)).toEqual([fixture.tool]);
    const payload = applied[0]?.payload;
    const parsed = graphicsCommandPayloads[fixture.tool].safeParse(payload);
    expect(parsed.error?.issues).toBeUndefined();
    expect(payload).toEqual(expected);
    // Plain text only: no markup, script or link in anything the model wrote.
    for (const text of strings((payload as { params?: unknown }).params))
      expect(text).not.toMatch(/[<>]|https?:|javascript:/i);
  });

  it("a graphic's length is a RationalTime all the way to core's payload, never milliseconds", async () => {
    const { applied } = await run(FIXTURES[13]!);
    expect(applied[0]?.payload).toMatchObject({ duration: { value: 75, rate: { num: 30, den: 1 } } });
    expect(applied[0]?.payload).not.toHaveProperty('durationMs');
    const parsed = graphicsCommandPayloads[GRAPHICS_COMMANDS.edit].parse(applied[0]?.payload);
    expect(parsed.duration && RationalTime.toSeconds(parsed.duration)).toBe(2.5);
  });

  it('the slot a prompt names is the one the pointer note resolved', async () => {
    const { applied } = await run(FIXTURES[12]!);
    expect(applied[0]?.payload).toMatchObject({ anchor: { kind: 'slot', slotId: v.slotIds[1] } });
  });

  it('covers the design job and every command an Editor prompt calls', () => {
    // EDT1-GFX: graphics.useProposal is the person's "Use it". HFW1: graphics.placeComposition and
    // graphics.setComposition are the Designer's, through workspace.place and workspace.replace (render
    // test/workspace/tools), never the Editor's prompt.
    const unprompted: readonly string[] = [
      GRAPHICS_COMMANDS.useProposal,
      GRAPHICS_COMMANDS.placeComposition,
      GRAPHICS_COMMANDS.setComposition,
    ];
    const prompted = Object.values(GRAPHICS_COMMANDS).filter((name) => !unprompted.includes(name));
    expect(new Set(FIXTURES.map((f) => f.tool))).toEqual(new Set([GRAPHICS_DESIGN_TOOL, ...prompted]));
  });
});
