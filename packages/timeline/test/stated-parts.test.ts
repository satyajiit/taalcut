// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM1: the model states the part of a shot a slot plays; the tools enforce it (SPEC, "MOM1: the part of a shot").
 * The stretch is brought inside the shot and made long enough for the slot; the cast chooses the window inside it by
 * its own rule, never locks the clip, and assembly's step with the person keeps to it.
 */
import { newId, RationalTime, type ShotProfile } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { personInPoints } from '../src/assembly/person-in-points';
import { createMemoryShotCatalog } from '../src/casting/catalog';
import { CASTING_CONFIG } from '../src/casting/config';
import { createCastingEngine } from '../src/casting/engine';
import { partStarts, type StatedPart } from '../src/casting/stated-parts';
import { fakeEmbedder, makeProfile, unitVector } from './fixtures/library';
import { withMoments } from './fixtures/moments';
import { fakeSubjects, pushInShot, standsThenWalks } from './fixtures/people';
import { buildTemplate } from './fixtures/template';

const config = CASTING_CONFIG;

describe('the starts a stated part allows', () => {
  /** 10 s at 30 fps that starts 2 s into its file, with three moments. */
  const shot = withMoments(makeProfile({ embedding: unitVector(1), frames: 300, offset: 60 }), [
    { to: 90, note: 'A', fit: 0.5 },
    { to: 240, note: 'B', fit: 0.5 },
    { to: 300, note: 'C', fit: 0.5 },
  ]);

  it('limits a window to a stretch as long as the slot or longer, in seconds of the shot’s file', () => {
    // 5 s to 9 s of the file is frames 90 to 210 of the shot: a 30-frame window starts at 90..180.
    expect(partStarts(shot, 30, { from: 5, to: 9 })).toEqual({ first: 90, last: 180, inside: true });
    // No end stated: to the end of the moment that holds the start (B, to frame 240).
    expect(partStarts(shot, 30, { from: 5 })).toEqual({ first: 90, last: 210, inside: true });
    // An end not after the start is no end.
    expect(partStarts(shot, 30, { from: 5, to: 4 })).toEqual({ first: 90, last: 210, inside: true });
  });

  it('makes a stretch shorter than the slot just long enough: the window holds all of it', () => {
    // Half a second from 6 s (frames 120 to 135) for a 30-frame window: any start that covers it.
    expect(partStarts(shot, 30, { from: 6, to: 6.5 })).toEqual({ first: 105, last: 120, inside: false });
    // The last moment is 2 s long (frames 240 to 300): a 3 s window must reach back before it.
    expect(partStarts(shot, 90, { from: 10 })).toEqual({ first: 210, last: 210, inside: false });
  });

  it('brings a stretch stated outside the shot inside it', () => {
    // Before the shot's start in its file, and past its end.
    expect(partStarts(shot, 30, { from: 0, to: 3 })).toEqual({ first: 0, last: 0, inside: true });
    expect(partStarts(shot, 30, { from: 11.5, to: 30 })).toEqual({ first: 270, last: 270, inside: false });
    expect(partStarts(shot, 30, { from: 60 })).toEqual({ first: 270, last: 270, inside: false });
  });

  it('gives a shot without moments the slot’s own length from the start, and nothing a shot too short', () => {
    const plain = makeProfile({ embedding: unitVector(2), frames: 300 });
    expect(partStarts(plain, 30, { from: 4 })).toEqual({ first: 120, last: 120, inside: true });
    expect(partStarts(plain, 301, { from: 4 })).toBeNull();
    expect(partStarts(makeProfile({ embedding: unitVector(3), kind: 'image' }), 30, { from: 0 })).toBeNull();
  });
});

describe('a cast with stated parts', () => {
  function world() {
    const template = buildTemplate({
      slots: [
        { frames: 15, text: 'opening' },
        { frames: 30, text: 'the walk', anchor: false },
        { frames: 15, text: 'closing' },
      ],
    });
    const profiles: ShotProfile[] = [
      pushInShot(8, { bestFrame: 30, embedding: unitVector(21) }),
      pushInShot(4, { embedding: unitVector(22) }),
      pushInShot(4, { embedding: unitVector(23) }),
    ];
    const table = new Map(
      template.slots.map((slot, index) => [slot.intent.text, profiles[(index + 2) % 3]!.embedding]),
    );
    const engine = createCastingEngine({
      catalog: createMemoryShotCatalog(profiles),
      embedder: fakeEmbedder(table),
    });
    const cast = async (parts?: StatedPart[]) => {
      const result = await engine.cast({
        projectId: newId<'Project'>(),
        template,
        mode: 'template',
        variants: 1,
        seed: 1,
        ...(parts ? { parts } : {}),
      });
      if (!result.ok) throw new Error(result.error.code);
      return result.value;
    };
    return { template, profiles, engine, cast, long: profiles[0]!, slotId: template.slots[1]!.id };
  }

  it('plays the pick from inside the stated stretch, without locking the clip', async () => {
    const w = world();
    const plain = (await w.cast()).variants[0]!.slots[1]!;
    expect(plain.pick!.assetId).toBe(w.long.assetId);
    // The rule alone: near the best frame, a second in.
    expect(plain.pick!.sourceStart.value).toBeLessThan(90);
    const stated = (await w.cast([{ slotId: w.slotId, shotId: w.long.shotId!, from: 5, to: 7 }])).variants[0]!
      .slots[1]!;
    expect(stated.pick!.shotId).toBe(w.long.shotId);
    expect(stated.pick!.sourceStart.value).toBeGreaterThanOrEqual(150);
    expect(stated.pick!.sourceStart.value + 30).toBeLessThanOrEqual(210);
    // Nothing else about the cast changes: the same picks, and the clip is the cast's, not a person's.
    expect(stated.note).toBe(plain.note);
    expect(stated.note).not.toBe('userPick');
    expect(stated.confidence).toBe(plain.confidence);
  });

  it('leaves a slot alone when the part names a shot the slot did not get, or a slot the template lacks', async () => {
    const w = world();
    const plain = await w.cast();
    const other = w.profiles[1]!;
    const stated = await w.cast([
      { slotId: w.slotId, shotId: other.shotId!, from: 2 },
      { slotId: newId<'TemplateSlot'>(), shotId: w.long.shotId!, from: 5 },
    ]);
    expect(stated.variants[0]!.slots.map((slot) => slot.pick?.sourceStart)).toEqual(
      plain.variants[0]!.slots.map((slot) => slot.pick?.sourceStart),
    );
  });

  it('holds the step with the person to the stated stretch', async () => {
    const w = world();
    const parts: StatedPart[] = [{ slotId: w.slotId, shotId: w.long.shotId!, from: 0.5, to: 2.5 }];
    const cast = await w.cast(parts);
    // The person stands for 3 s, then walks: left to itself the step moves the clip past 3 s.
    const fake = () => fakeSubjects(new Map([[w.long.assetId, standsThenWalks(3)]]));
    const free = await personInPoints(
      { subjects: fake().source, profiles: w.engine.profiles! },
      w.template,
      cast,
      config,
      5_000,
    );
    expect(free.cast.variants[0]!.slots[1]!.pick!.sourceStart.value).toBeGreaterThanOrEqual(90);
    const held = await personInPoints(
      { subjects: fake().source, profiles: w.engine.profiles!, parts },
      w.template,
      cast,
      config,
      5_000,
    );
    const start = held.cast.variants[0]!.slots[1]!.pick!.sourceStart.value;
    expect(start).toBeGreaterThanOrEqual(15);
    expect(start + 30).toBeLessThanOrEqual(75);
  });

  it('gives the engine’s slot specs what each slot states, embedded', async () => {
    const w = world();
    const specs = await w.engine.slotSpecs!(w.template);
    expect(specs.map((spec) => spec.intentVector && [...spec.intentVector])).toEqual(
      w.template.slots.map((_, index) => [...w.profiles[(index + 2) % 3]!.embedding]),
    );
    // The cast itself weighs a shot's moments against them: the long shot's second half shows the walk.
    const told = withMoments(w.long, [
      { to: 120, note: 'People stand about.', fit: 0.2 },
      { to: 240, note: 'A man walks down the street.', fit: 0.9 },
    ]);
    // The second note's vector is the walking slot's own ask; the first points elsewhere.
    const moments = told.moments!.map((moment, index) => ({
      ...moment,
      vector: index === 1 ? w.long.embedding : unitVector(77),
    }));
    const engine = createCastingEngine({
      catalog: createMemoryShotCatalog([{ ...told, moments }, w.profiles[1]!, w.profiles[2]!]),
      embedder: fakeEmbedder(
        new Map(
          w.template.slots.map((slot, index) => [slot.intent.text, w.profiles[(index + 2) % 3]!.embedding]),
        ),
      ),
    });
    const result = await engine.cast({
      projectId: newId<'Project'>(),
      template: w.template,
      mode: 'template',
      variants: 1,
      seed: 1,
    });
    if (!result.ok) throw new Error(result.error.code);
    const pick = result.value.variants[0]!.slots[1]!.pick!;
    expect(pick.shotId).toBe(w.long.shotId);
    // 4 s into the shot, where the walk starts (a frame or two of the stretch before it costs nothing).
    expect(RationalTime.toSeconds(pick.sourceStart)).toBeGreaterThan(3.9);
  });
});
