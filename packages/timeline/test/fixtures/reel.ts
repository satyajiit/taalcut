// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * KEEP1: a reel whose template states some slots as the reel's own footage, and the person's clips. The slots, in
 * frames at 30 fps, are the owner's: the creator's clip (0–323), a film scene (324–452) and its last frames
 * (453–466). `kept` says which slots keep the reel's footage. The library records every vector it is asked for, so
 * a test can show that casting never looked for a reel slot.
 */
import {
  newId,
  ok,
  templateSchema,
  type AssetId,
  type ShotProfile,
  type SlotFootage,
  type SlotLands,
  type Template,
} from '@taalcut/core';
import { createMemoryShotCatalog, type ShotCatalog } from '../../src/casting/catalog';
import { createCastingEngine } from '../../src/casting/engine';
import type { ReelSource, ReelSourceInput } from '../../src/tools/reel-source';
import type { World } from './casting';
import { fakeEmbedder, makeProfile, near, unitVector, type ProfileDef } from './library';
import { buildTemplate, type OverlayDef, type SlotDef } from './template';

export const REEL_SLOTS: readonly SlotDef[] = [
  { frames: 324, text: 'the creator talks to the camera' },
  { frames: 129, text: 'a film scene: an actor answers' },
  { frames: 14, text: 'the film scene ends' },
];
export const REEL_FRAMES = 467;
export const FILM_REASON = 'A film scene the joke lands on';

export interface ReelWorldDef {
  /** Indexes of the slots that keep the reel's own footage. */
  readonly kept: readonly number[];
  readonly slots?: readonly SlotDef[];
  readonly overlays?: readonly OverlayDef[];
  /** The person's clips (default one), each near a person slot's intent in turn. */
  readonly clips?: number;
  readonly by?: SlotFootage['by'];
  /** MATCH1: the moment a slot states for its start or end, by slot index. */
  readonly lands?: Readonly<Record<number, SlotLands>>;
  /** MATCH1: the person's clips' length, rate and the rest (default 900 frames at 30 a second). */
  readonly clip?: Partial<Omit<ProfileDef, 'embedding'>>;
}

export interface ReelWorld extends World {
  /** The intent vectors, by slot. */
  readonly intents: Float32Array[];
  /** Every vector the library was asked for the nearest shots to. */
  readonly asked: Float32Array[];
}

const sameVector = (a: Float32Array, b: Float32Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** Whether the library was asked for shots near this slot's intent. */
export const askedFor = (w: ReelWorld, slot: number) =>
  w.asked.some((vector) => sameVector(vector, w.intents[slot]!));

export function reelWorld(def: ReelWorldDef): ReelWorld {
  const slotDefs = def.slots ?? REEL_SLOTS;
  const intents = slotDefs.map((_, index) => unitVector(9_100 + index));
  const built = buildTemplate({ slots: slotDefs, ...(def.overlays ? { overlays: def.overlays } : {}) });
  const template: Template = templateSchema.parse({
    ...built,
    origin: {
      kind: 'reference',
      input: 'link',
      platform: 'reels',
      url: 'https://example.com/reel/1',
      fingerprint: 'a'.repeat(64),
      source: { duration: built.duration, rate: built.canvas.rate, width: 1080, height: 1920 },
      crop: null,
      pipelineVersion: '1',
      configVersion: '1',
      analysedAt: 0,
    },
    slots: built.slots.map((slot, index) => ({
      ...slot,
      ...(def.kept.includes(index)
        ? { footage: { from: 'reel', by: def.by ?? 'analyst', reason: FILM_REASON } }
        : {}),
      ...(def.lands?.[index] ? { lands: def.lands[index] } : {}),
    })),
  });
  const person = slotDefs.flatMap((_, index) => (def.kept.includes(index) ? [] : [index]));
  const profiles: ShotProfile[] = Array.from({ length: def.clips ?? 1 }, (_, index) =>
    makeProfile({
      embedding: near(intents[person[index % Math.max(1, person.length)] ?? 0]!, 500 + index, 0.1),
      frames: 900,
      ...def.clip,
    }),
  );
  const table = new Map(slotDefs.map((slot, index) => [slot.text!, intents[index]!]));
  const memory = createMemoryShotCatalog(profiles);
  const asked: Float32Array[] = [];
  const catalog: ShotCatalog = {
    ...memory,
    nearest: (query, filter, k, signal) => {
      asked.push(query);
      return memory.nearest(query, filter, k, signal);
    },
  };
  const engine = createCastingEngine({ catalog, embedder: fakeEmbedder(table) });
  return { template, profiles, acceptable: [], engine, intents, asked };
}

/** A reel source that answers one asset and records what it was asked. */
export function reelSource(): { source: ReelSource; assetId: AssetId; calls: ReelSourceInput[] } {
  const assetId = newId<'Asset'>();
  const calls: ReelSourceInput[] = [];
  return {
    assetId,
    calls,
    source: async (input) => {
      calls.push(input);
      return ok({ assetId });
    },
  };
}
