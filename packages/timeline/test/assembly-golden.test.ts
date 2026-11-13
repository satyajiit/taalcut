// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-M4 done-when: golden assemblies (three synthetic templates, one NTSC
 * with 25 fps media, one with many transitions) place every cut within one
 * frame of its beat anchor. Also: transitions clamped, ramps, text, gaps.
 */
import {
  FrameRates,
  newId,
  timelineSchema,
  type FrameRate,
  type ShotProfile,
  type Template,
  type Timeline,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { assemble } from '../src/assembly/assemble';
import { createMemoryShotCatalog } from '../src/casting/catalog';
import { createCastingEngine } from '../src/casting/engine';
import { cutsOffAnchor } from '../src/model/checks';
import { MARKER_LABELS } from '../src/model/markers';
import { positions, videoItems } from '../src/model/sequence';
import { rampProblems } from '../src/model/validate';
import { resync } from '../src/resync/resync';
import { fakeEmbedder, makeProfile, unitVector } from './fixtures/library';
import { buildTemplate, type SlotDef } from './fixtures/template';

const ids = { item: () => newId<'TimelineItem'>() };

function library(count: number, rate: FrameRate, frames = 400): ShotProfile[] {
  return Array.from({ length: count }, (_, index) =>
    makeProfile({ embedding: unitVector(500 + index), rate, frames, offset: 30, place: `p${index % 3}` }),
  );
}

async function castAndAssemble(template: Template, profiles: ShotProfile[], texts?: Record<string, string>): Promise<Timeline> {
  const engine = createCastingEngine({ catalog: createMemoryShotCatalog(profiles), embedder: fakeEmbedder(new Map()) });
  const projectId = newId<'Project'>();
  const cast = await engine.cast({ projectId, template, mode: 'template', variants: 1, seed: 1 });
  if (!cast.ok) throw new Error(cast.error.code);
  const assembled = assemble(
    {
      projectId,
      template,
      variant: cast.value.variants[0]!,
      cast: { castId: cast.value.castId, mode: 'template', variantIndex: 0, variantCount: 1, configVersion: cast.value.configVersion },
      ...(texts ? { texts } : {}),
      timelineId: newId<'Timeline'>(),
      name: 'Golden',
      now: 1_000,
    },
    ids,
  );
  if (!assembled.ok) throw new Error(`${assembled.error.code} ${assembled.error.detail ?? ''}`);
  return assembled.value;
}

function golden(timeline: Timeline, template: Template): void {
  expect(timelineSchema.safeParse(timeline).success).toBe(true);
  expect(rampProblems(timeline)).toEqual([]);
  expect(cutsOffAnchor(timeline)).toEqual([]);
  const all = positions(videoItems(timeline));
  expect(all.map((position) => position.start)).toEqual(template.slots.map((slot) => slot.start.value));
  expect(all.map((position) => position.item.slotId)).toEqual(template.slots.map((slot) => slot.id));
  // A fresh assembly is already synced.
  expect(resync(timeline)).toEqual(timeline);
}

describe('golden assemblies', () => {
  it('30 fps: every cut on its anchor, ramps kept, text from the Editor', async () => {
    const slots: SlotDef[] = [
      { frames: 45 },
      { frames: 30, ramp: [[0, 1], [15, 2]] },
      { frames: 15 },
      { frames: 30 },
      { frames: 60 },
      { frames: 15 },
      { frames: 30 },
      { frames: 45 },
    ];
    const template = buildTemplate({
      slots,
      overlays: [
        { start: 0, frames: 45, text: 'POV: you finally went', slot: 0 },
        { start: 30, frames: 30, text: 'day one', slot: 0 },
        { start: 120, frames: 60, text: 'worth it', slot: 4 },
      ],
    });
    const overlay = template.text[2]!.id;
    const timeline = await castAndAssemble(template, library(20, FrameRates.fps30), { [overlay]: 'Goa was worth it' });
    golden(timeline, template);
    const ramped = positions(videoItems(timeline))[1]!.item;
    expect(ramped.type === 'clip' && ramped.speed).toEqual(template.slots[1]!.speedRamp);
    const text = timeline.tracks.filter((track) => track.kind === 'text');
    expect(text.map((track) => track.id)).toEqual(['T1', 'T2']);
    const items = text.flatMap((track) => (track.kind === 'text' ? track.items : [])).filter((item) => item.type === 'text');
    expect(items.find((item) => item.overlayId === overlay)).toMatchObject({ text: 'Goa was worth it', origin: 'editor' });
    expect(items.find((item) => item.overlayId === template.text[0]!.id)).toMatchObject({ origin: 'template' });
    expect(timeline.markers.find((marker) => marker.kind === 'hook')?.range.duration.value).toBe(45);
    expect(timeline.cast?.slots.every((slot) => slot.clipId !== null)).toBe(true);
    expect(timeline.music).toEqual({ path: 'platformSound' });
    for (const position of positions(videoItems(timeline)))
      expect(position.item.type === 'clip' && position.item.audio.muted).toBe(true);
  });

  it('NTSC canvas with 25 fps media: every cut within one frame of its anchor', async () => {
    const template = buildTemplate({
      rate: FrameRates.fps29_97,
      slots: [{ frames: 30 }, { frames: 45 }, { frames: 15 }, { frames: 30 }, { frames: 30 }, { frames: 60 }],
    });
    const timeline = await castAndAssemble(template, library(12, FrameRates.fps25));
    golden(timeline, template);
    const [first] = positions(videoItems(timeline));
    expect(first?.item.type === 'clip' && first.item.sourceStart.rate).toEqual(FrameRates.fps25);
  });

  it('many transitions: offsets clamped to the media and a plain cut where there is none', async () => {
    const slots: SlotDef[] = [
      { frames: 30 },
      { frames: 30, transition: { kind: 'dissolve', before: 6, after: 6 } },
      { frames: 30, transition: { kind: 'whip', before: 4, after: 4 } },
      { frames: 30, transition: { kind: 'zoom', before: 10, after: 10 } },
      { frames: 30, transition: { kind: 'fade', before: 15, after: 15 } },
      { frames: 30, transition: { kind: 'slide', before: 2, after: 2 } },
    ];
    const template = buildTemplate({ slots });
    // Shots start at frame 0 of their files, so nothing exists before an in-point there.
    const tight = Array.from({ length: 10 }, (_, index) => makeProfile({ embedding: unitVector(700 + index), frames: 400, peaks: [0, 200] }));
    const timeline = await castAndAssemble(template, tight);
    golden(timeline, template);
    const transitions = videoItems(timeline).filter((item) => item.type === 'transition');
    for (const transition of transitions) expect(transition.inOffset.value).toBeLessThanOrEqual(15);
    const noted = timeline.markers.filter((marker) => marker.label === MARKER_LABELS.noHandle);
    expect(transitions.length + noted.length).toBe(5);
  });

  it('leaves a gap for a slot nothing can fill, and marks picks with no peak on the beat', async () => {
    const template = buildTemplate({ slots: [{ frames: 30 }, { frames: 900 }, { frames: 30 }] });
    const flat = library(6, FrameRates.fps30, 300).map((profile) => ({ ...profile, motionPeakFrames: [] }));
    const timeline = await castAndAssemble(template, flat);
    golden(timeline, template);
    const types = videoItems(timeline).map((item) => item.type);
    expect(types).toEqual(['clip', 'gap', 'clip']);
    expect(timeline.cast?.slots[1]).toMatchObject({ clipId: null, pick: null, note: 'noCandidates' });
    expect(timeline.markers.filter((marker) => marker.label === MARKER_LABELS.noSyncPoint)).toHaveLength(2);
  });

  it('refuses a variant whose media it does not know', () => {
    const template = buildTemplate({ slots: [{ frames: 30 }] });
    const profile = makeProfile({ embedding: unitVector(1) });
    const variant = {
      slots: [
        {
          slotId: template.slots[0]!.id,
          clipId: null,
          pick: { assetId: profile.assetId, shotId: profile.shotId, sourceStart: profile.range.start, syncPoint: null, score: 1, parts: { intent: 1, motion: 1, quality: 1, subject: 1, energy: 1, hook: null, rerank: null, penalty: 0 } },
          alternates: [],
          confidence: 1,
          needsRerank: false,
          note: null,
        },
      ],
      score: 1,
      sequenceConfidence: 1,
      media: [],
    };
    const result = assemble(
      {
        projectId: newId<'Project'>(),
        template,
        variant,
        cast: { castId: newId<'Cast'>(), mode: 'template', variantIndex: 0, variantCount: 1, configVersion: 'casting.v4' },
        timelineId: newId<'Timeline'>(),
        name: 'x',
        now: 0,
      },
      ids,
    );
    expect(!result.ok && result.error.code).toBe('timeline.media_missing');
  });
});
