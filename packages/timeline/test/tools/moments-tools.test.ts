// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM1: what the timeline tools show of a shot's moments, and the part a model states (SPEC, "MOM1: the part of a
 * shot"). `timeline.cast` lists each rerank candidate's moments after its description, within a budget, and says
 * where those slots' picks play from; `parts` on a cast and an assembly is enforced and answered; `timeline.get` says
 * what the part each clip plays shows and what the rest of its shot shows, a docked run the played part only.
 */
import { newId, ok, RationalTime, type AnyTool, type Clip, type ShotProfile } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createMemoryShotCatalog } from '../../src/casting/catalog';
import { createCastingEngine } from '../../src/casting/engine';
import { videoItems } from '../../src/model/sequence';
import { createTimelineService } from '../../src/service/service';
import { MAKER_PROMPT } from '../../src/skills/maker-prompt';
import { LIBRARIAN_PROMPT } from '../../src/skills/prompts';
import { createClipNumbering } from '../../src/tools/clip-refs';
import { partOutcome } from '../../src/tools/cast-answer';
import { readTools } from '../../src/tools/read-tools';
import { rerankMaterial } from '../../src/tools/rerank-material';
import { MOMENT_WORDS, momentsLine, partLines, RERANK_MOMENT_CHARS } from '../../src/tools/shot-moments';
import { editorWorld } from '../editor/editor-world';
import { agentWorldOver } from '../fixtures/agent';
import { world, type World } from '../fixtures/casting';
import { fakeEmbedder, makeProfile, unitVector } from '../fixtures/library';
import { withMoments } from '../fixtures/moments';
import { agentToolContext } from '../fixtures/tool-context';

const SEED = 17;
const SLOTS = 13;

/** Every shot in two moments, cut at its middle, their notes not embedded (casting is as before MOM1). */
const inTwo = (profile: ShotProfile): ShotProfile => {
  const length = profile.range.duration.value;
  const id = (profile.shotId ?? '').slice(-4);
  return withMoments(profile, [
    { to: Math.floor(length / 2), note: `Hands hold up tickets, shot ${id}.`, fit: null },
    { to: length, note: `The floor of the hall, shot ${id}.`, fit: null },
  ]);
};

/** A library where most slots are unsure with alternates (librarian-turns.test.ts), each shot with two moments. */
function momentsWorld(): World {
  const base = world({ slots: SLOTS, perSlot: 4, distractors: 0, seed: SEED, noise: 0.02 });
  const profiles = base.profiles.map(inTwo);
  const table = new Map(
    base.template.slots.map((_, index) => [`intent ${SEED}-${index}`, unitVector(SEED * 1000 + index)]),
  );
  const engine = createCastingEngine({
    catalog: createMemoryShotCatalog(profiles),
    embedder: fakeEmbedder(table),
  });
  return { ...base, profiles, engine };
}

const describedAll = async (shotIds: readonly string[]) =>
  ok(new Map(shotIds.map((id) => [id, `A hall, shot ${id.slice(-4)}`])));

interface SlotRow {
  readonly slotId: string;
  readonly shotId: string;
  readonly alternates: string[];
  readonly playsShotFrom?: number;
  readonly part?: string;
}

describe('moments in words', () => {
  const shot = withMoments(makeProfile({ embedding: unitVector(1), frames: 300, offset: 60 }), [
    { to: 90, note: 'Hands hold up tickets.', fit: null },
    { to: 240, note: 'The camera tilts down.', fit: null },
    { to: 300, note: 'The floor, with suitcases.', fit: null },
  ]);

  it('gives a shot’s moments with their times in seconds of its file', () => {
    // The shot starts 2 s into its file.
    expect(momentsLine(shot)).toBe(
      '2-5s: Hands hold up tickets.; 5-10s: The camera tilts down.; 10-12s: The floor, with suitcases.',
    );
    expect(momentsLine(makeProfile({ embedding: unitVector(2) }))).toBeNull();
    // One moment says what the shot's sentence says: nothing to choose between, nothing shown.
    const whole = withMoments(makeProfile({ embedding: unitVector(2), frames: 300 }), [
      { to: 300, note: 'A boat crosses the bay.', fit: null },
    ]);
    expect(momentsLine(whole)).toBeNull();
    expect(partLines(whole, 1, 1)).toEqual({ plays: null, rest: null });
  });

  it('shows a few moments, each note cut short', () => {
    const wordy = withMoments(
      makeProfile({ embedding: unitVector(4), frames: 300 }),
      Array.from({ length: 5 }, (_, n) => ({
        to: (n + 1) * 60,
        note: `${n} ${'word '.repeat(40)}`.trim(),
        fit: null,
      })),
    );
    const line = momentsLine(wordy)!;
    const shown = line.split('; ');
    // Three moments and a count of the rest; each note at most 100 characters after its times.
    expect(shown).toHaveLength(MOMENT_WORDS.rerank.count + 1);
    expect(shown.at(-1)).toBe('+2 more');
    for (const moment of shown.slice(0, -1))
      expect(moment.replace(/^[\d.]+-[\d.]+s: /, '').length).toBeLessThanOrEqual(MOMENT_WORDS.rerank.chars);
    const { plays, rest } = partLines(wordy, 0.5, 1);
    expect(plays!.split('; ')).toHaveLength(1);
    expect(rest!.split('; ')).toHaveLength(MOMENT_WORDS.rest.count + 1);
  });

  it('says what a clip’s part plays, and the rest of the shot', () => {
    // A second from 10.5 s of the file: the last moment.
    expect(partLines(shot, 10.5, 1)).toEqual({
      plays: '10-12s: The floor, with suitcases.',
      rest: '2-5s: Hands hold up tickets.; 5-10s: The camera tilts down.',
    });
    // Across a boundary: both moments play.
    expect(partLines(shot, 4.5, 1).plays).toBe('2-5s: Hands hold up tickets.; 5-10s: The camera tilts down.');
    expect(partLines(shot, 2, 10)).toMatchObject({ rest: null });
    expect(partLines(makeProfile({ embedding: unitVector(2) }), 1, 1)).toEqual({ plays: null, rest: null });
  });

  it('reads a stated part as kept when the window lies inside it', () => {
    expect(partOutcome({ from: 4, to: 6 }, 4.5, 1)).toBe('kept');
    expect(partOutcome({ from: 4, to: 6 }, 5.5, 1)).toBe('widened');
    expect(partOutcome({ from: 4, to: 6 }, 3.5, 1)).toBe('widened');
    expect(partOutcome({ from: 4 }, 4.02, 1)).toBe('kept');
  });
});

describe('timeline.cast and timeline.assemble with moments', () => {
  const target = (w: { projectId: string; template: { id: string } }) => ({
    projectId: w.projectId,
    template: { id: w.template.id },
  });

  it('lists each rerank candidate’s moments after its description, and where those slots’ picks play from', async () => {
    const w = agentWorldOver(momentsWorld(), { shotDescriptions: describedAll });
    const cast = await w.call('timeline.cast', target(w));
    if (!cast.ok) throw new Error(cast.error.code);
    const listed = cast.value.rerank as { candidates: { shotId: string; description: string }[] }[];
    expect(listed).toHaveLength(3);
    for (const slot of listed)
      for (const candidate of slot.candidates) {
        const id = candidate.shotId.slice(-4);
        expect(candidate.description).toMatch(
          new RegExp(
            `^A hall, shot ${id} \\| 0-[\\d.]+s: Hands hold up tickets, shot ${id}\\.; ` +
              `[\\d.]+-[\\d.]+s: The floor of the hall, shot ${id}\\.$`,
          ),
        );
      }
    const slots = (cast.value.variants as { slots: SlotRow[] }[])[0]!.slots;
    // A slot listed for a rerank says where its pick plays from, beside the moments; the others don't.
    const asked = new Set((cast.value.rerank as { slotId: string }[]).map((slot) => slot.slotId));
    for (const slot of slots)
      expect(typeof slot.playsShotFrom).toBe(asked.has(slot.slotId) ? 'number' : 'undefined');
    expect(slots.every((slot) => slot.part === undefined)).toBe(true);
    // What the moments add to the answer is bounded, whatever the shots say.
    const plain = agentWorldOver(
      world({ slots: SLOTS, perSlot: 4, distractors: 0, seed: SEED, noise: 0.02 }),
      {
        shotDescriptions: describedAll,
      },
    );
    const before = await plain.call('timeline.cast', target(plain));
    if (!before.ok) throw new Error(before.error.code);
    const added = JSON.stringify(cast.value).length - JSON.stringify(before.value).length;
    expect(added).toBeGreaterThan(0);
    expect(added).toBeLessThanOrEqual(RERANK_MOMENT_CHARS + 15 * 3 + 3 * 30);
  });

  it('stops showing moments when the list has its fill of them', async () => {
    const base = momentsWorld();
    const wordy = base.profiles.map((profile) =>
      withMoments(profile, [
        { to: 30, note: `First ${'word '.repeat(30)}`.trim(), fit: null },
        { to: 60, note: `Second ${'word '.repeat(30)}`.trim(), fit: null },
        { to: profile.range.duration.value, note: `Third ${'word '.repeat(30)}`.trim(), fit: null },
      ]),
    );
    const w = agentWorldOver(base, { shotDescriptions: describedAll });
    const cast = await w.engine.cast({
      template: w.template,
      mode: 'montage',
      variants: 1,
      seed: 1,
    } as never);
    if (!cast.ok) throw new Error(cast.error.code);
    const listed = await rerankMaterial(cast.value, w.template, describedAll as never, {
      count: 5,
      profiles: async (refs) =>
        ok(wordy.filter((profile) => refs.some((ref) => ref.shotId === profile.shotId))),
    });
    const lines = listed.flatMap((slot) => slot.candidates.map((c) => c.description?.split(' | ')[1] ?? ''));
    expect(lines.filter(Boolean).length).toBeGreaterThan(0);
    expect(lines.filter((line) => !line).length).toBeGreaterThan(0);
    expect(lines.join('').length).toBeLessThanOrEqual(RERANK_MOMENT_CHARS);
    // The least sure slot's candidates come first: they are the ones shown.
    expect(lines[0]).toMatch(/^0-1s: First /);
  });

  it('enforces a stated part and says what became of it', async () => {
    const w = agentWorldOver(momentsWorld(), { shotDescriptions: describedAll });
    const first = await w.call('timeline.cast', target(w));
    if (!first.ok) throw new Error(first.error.code);
    const rows = (first.value.variants as { slots: SlotRow[] }[])[0]!.slots;
    const [a, b, c] = rows as [SlotRow, SlotRow, SlotRow];
    const lengthOf = (shotId: string) =>
      RationalTime.toSeconds(w.profiles.find((profile) => profile.shotId === shotId)!.range.duration);
    const parts = [
      // The last two seconds of the first slot's shot; a tenth of a second of the second's; another shot for the third.
      { slotId: a.slotId, shotId: a.shotId, from: lengthOf(a.shotId) - 2, to: lengthOf(a.shotId) },
      { slotId: b.slotId, shotId: b.shotId, from: 3, to: 3.1 },
      { slotId: c.slotId, shotId: a.shotId, from: 1 },
    ];
    const cast = await w.call('timeline.cast', { ...target(w), parts });
    if (!cast.ok) throw new Error(cast.error.code);
    const stated = (cast.value.variants as { slots: SlotRow[] }[])[0]!.slots;
    expect(stated.map((slot) => slot.shotId)).toEqual(rows.map((slot) => slot.shotId));
    expect(stated[0]).toMatchObject({ part: 'kept' });
    expect(stated[0]!.playsShotFrom).toBeGreaterThanOrEqual(lengthOf(a.shotId) - 2 - 0.01);
    expect(stated[0]!.playsShotFrom! + 1).toBeLessThanOrEqual(lengthOf(a.shotId) + 0.01);
    // A tenth of a second can't hold a one-second slot: the window holds it, and the answer says it was widened.
    expect(stated[1]).toMatchObject({ part: 'widened' });
    expect(stated[1]!.playsShotFrom).toBeLessThanOrEqual(3);
    expect(stated[1]!.playsShotFrom! + 1).toBeGreaterThanOrEqual(3.1 - 0.01);
    expect(stated[2]).toMatchObject({ part: 'otherShot' });
    expect(typeof stated[2]!.playsShotFrom).toBe('number');
    expect(stated.slice(3).every((slot) => slot.part === undefined)).toBe(true);

    const assembled = await w.call('timeline.assemble', { ...target(w), parts });
    if (!assembled.ok) throw new Error(assembled.error.code);
    const [timelineId] = assembled.value.timelineIds as string[];
    expect(assembled.value.parts).toEqual([
      {
        timelineId,
        slotId: a.slotId,
        shotId: a.shotId,
        playsShotFrom: stated[0]!.playsShotFrom,
        part: 'kept',
      },
      {
        timelineId,
        slotId: b.slotId,
        shotId: b.shotId,
        playsShotFrom: stated[1]!.playsShotFrom,
        part: 'widened',
      },
      { timelineId, slotId: c.slotId, shotId: a.shotId, playsShotFrom: null, part: 'otherShot' },
    ]);
    // The clip itself plays from there, and is the cast's own: no lock, not a person's pick.
    const clips = videoItems(w.store.docs.get(timelineId!)!).filter(
      (item): item is Clip => item.type === 'clip',
    );
    const placed = clips.find((clip) => clip.slotId === a.slotId)!;
    expect(RationalTime.toSeconds(placed.sourceStart)).toBeCloseTo(stated[0]!.playsShotFrom!, 2);
    expect(placed.locked).toBe(false);
    // Without parts the answer has none.
    const plain = await w.call('timeline.assemble', { ...target(w), timelineIds: [newId<'Timeline'>()] });
    expect(plain.ok && plain.value.parts).toBeUndefined();
  });

  it('shows what the part each clip plays shows, and the rest of its shot', async () => {
    const w = agentWorldOver(momentsWorld(), { shotDescriptions: describedAll });
    const assembled = await w.call('timeline.assemble', target(w));
    if (!assembled.ok) throw new Error(assembled.error.code);
    const read = await w.call('timeline.get', { timelineId: (assembled.value.timelineIds as string[])[0] });
    if (!read.ok) throw new Error(read.error.code);
    const clips = read.value.clips as {
      clipId: string;
      shotId: string;
      shows: string;
      playsShotFrom: number;
    }[];
    expect(clips).toHaveLength(SLOTS);
    for (const clip of clips) {
      const id = clip.shotId.slice(-4);
      const shot = w.profiles.find((profile) => profile.shotId === clip.shotId)!;
      const { plays, rest } = partLines(shot, clip.playsShotFrom, 1);
      // One string a clip: its id, the shot's sentence, the played part, the rest of the shot.
      expect(clip.shows).toBe(
        `${clip.clipId}: A hall, shot ${id} | plays ${plays}` + (rest ? ` | rest of the shot ${rest}` : ''),
      );
      expect(clip.shows).toMatch(/\| plays [\d.]+-[\d.]+s: /);
    }
    expect(clips.some((clip) => clip.shows.includes('| rest of the shot '))).toBe(true);
  });
});

describe('timeline.get in a docked run', () => {
  it('says the played part only, in the clip’s one block', async () => {
    const editor = await editorWorld({ clips: [{ frames: 30, sourceStart: 200 }, { frames: 30 }] });
    const clips = videoItems(editor.doc()).filter((item): item is Clip => item.type === 'clip');
    const shotOf = (clip: Clip) => (clip.media.kind === 'video' ? (clip.media.shotId as string) : '');
    const profiles = clips.map((clip) =>
      inTwo({
        ...makeProfile({ embedding: unitVector(3), frames: 300 }),
        assetId: clip.media.assetId,
        shotId: shotOf(clip) as ShotProfile['shotId'],
      }),
    );
    const service = createTimelineService({ store: editor.store, events: editor.events });
    const [get] = readTools({
      service,
      numbering: createClipNumbering(),
      shotDescriptions: describedAll,
      profiles: async (refs) =>
        ok(profiles.filter((profile) => refs.some((ref) => ref.shotId === profile.shotId))),
    }) as [AnyTool];
    const run = async (docked: boolean) => {
      const ctx = {
        ...agentToolContext(editor.bus, get),
        runId: newId<'AgentRun'>(),
        ...(docked ? { editor: { context: {}, targets: [] } as never } : {}),
      };
      const read = await get.run(get.input.parse({ timelineId: editor.target.timelineId }), ctx);
      if (!read.ok) throw new Error(read.error.code);
      return (read.value as { clips: { shows: string }[] }).clips.map((clip) => clip.shows);
    };
    const id = (index: number) => shotOf(clips[index]!).slice(-4);
    // Frame 200 of 300 at 30 fps: 6.67 s, in the second moment (5 s to 10 s).
    expect(await run(true)).toEqual([
      `clip 1: A hall, shot ${id(0)} | plays 5-10s: The floor of the hall, shot ${id(0)}.`,
      `clip 2: A hall, shot ${id(1)} | plays 0-5s: Hands hold up tickets, shot ${id(1)}.`,
    ]);
    expect((await run(false))[0]).toBe(
      `${clips[0]!.id}: A hall, shot ${id(0)} | plays 5-10s: The floor of the hall, shot ${id(0)}.` +
        ` | rest of the shot 0-5s: Hands hold up tickets, shot ${id(0)}.`,
    );
  });
});

describe('what the skills are told about a shot’s parts', () => {
  it('has the Librarian state the stretch whose moment fits, and the Maker play it', () => {
    expect(LIBRARIAN_PROMPT).toContain("After a candidate's description come its moments");
    expect(LIBRARIAN_PROMPT).toContain(
      'state that stretch as a part for timeline.assemble: {slotId, shotId, from, to}',
    );
    expect(LIBRARIAN_PROMPT).toContain('State a part only from moments you were given');
    // One sentence for another of the same size: the Maker's prompt has no room at 12,288 tokens (the desktop's
    // agent-make-flow-budget test). timeline.get's description says what "plays" and "rest of the shot" are.
    expect(MAKER_PROMPT).toContain('play the part that fits the slot with timeline.slipClip, not trimClip.');
  });
});
