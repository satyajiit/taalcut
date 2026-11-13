// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A synthetic casting world: a template whose slot intents are known vectors,
 * and a library where, for each slot, a few shots are "acceptable" (near the
 * intent, matching motion) among distractors. The acceptance fixture stands in
 * for P2-Q2's human labels until they exist.
 */
import { CAMERA_MOTIONS, newId, type CameraMotion, type ShotProfile, type Template } from '@taalcut/core';
import { createCastingEngine, type CastingEngine } from '../../src/casting/engine';
import { createMemoryShotCatalog, profileKey } from '../../src/casting/catalog';
import { fakeEmbedder, makeProfile, near, random, unitVector } from './library';
import { buildTemplate, type OverlayDef } from './template';

export interface WorldDef {
  readonly slots: number;
  /** Acceptable shots per slot. */
  readonly perSlot: number;
  readonly distractors: number;
  readonly seed: number;
  /** Noise added to an acceptable shot's vector (0 = the intent itself). */
  readonly noise?: number;
  /**
   * Per slot, shots as close to the intent as the acceptable ones but with the wrong camera motion and no
   * face: what a person would turn down although the words match.
   */
  readonly confusers?: number;
  readonly slotFrames?: number;
  readonly overlays?: readonly OverlayDef[];
}

export interface World {
  readonly template: Template;
  readonly profiles: ShotProfile[];
  /** Keys of the acceptable shots, per slot. */
  readonly acceptable: Set<string>[];
  readonly engine: CastingEngine;
}

export function world(def: WorldDef): World {
  const next = random(def.seed);
  const motions: CameraMotion[] = Array.from(
    { length: def.slots },
    (_, index) => CAMERA_MOTIONS[(index + def.seed) % CAMERA_MOTIONS.length] as CameraMotion,
  );
  const intents = Array.from({ length: def.slots }, (_, index) => unitVector(def.seed * 1000 + index));
  const template = buildTemplate({
    slots: intents.map((_, index) => ({
      frames: def.slotFrames ?? 30,
      text: `intent ${def.seed}-${index}`,
      motion: motions[index] ?? null,
      energy: 0.3 + 0.4 * next(),
    })),
    ...(def.overlays ? { overlays: def.overlays } : {}),
  });
  const table = new Map(intents.map((vector, index) => [`intent ${def.seed}-${index}`, vector]));
  const profiles: ShotProfile[] = [];
  const acceptable = intents.map((intent, slot) => {
    const keys = new Set<string>();
    for (let shot = 0; shot < def.perSlot; shot++) {
      const profile = makeProfile({
        embedding: near(intent, def.seed * 7919 + slot * 31 + shot, def.noise ?? 0.35),
        // People accept some shots whose motion doesn't match the reference: a quarter here.
        motionClass: next() < 0.75 ? (motions[slot] ?? null) : 'static',
        quality: 0.6 + 0.35 * next(),
        frames: 240 + Math.floor(next() * 240),
        capturedAt: 1_700_000_000_000 + Math.floor(next() * 1e8),
        place: `place-${Math.floor(next() * 4)}`,
        faceCount: next() > 0.5 ? 1 : 0,
        assetId: newId<'Asset'>(),
      });
      profiles.push(profile);
      keys.add(profileKey(profile));
    }
    return keys;
  });
  intents.forEach((intent, slot) => {
    const motion = motions[slot] ?? 'static';
    const wrong = CAMERA_MOTIONS.find((other) => other !== motion && other !== 'static' && motion !== 'static') ?? 'static';
    for (let shot = 0; shot < (def.confusers ?? 0); shot++)
      profiles.push(
        makeProfile({
          embedding: near(intent, def.seed * 6007 + slot * 37 + shot, def.noise ?? 0.35),
          // ...and turn down some whose motion does match.
          motionClass: next() < 0.25 ? motion : motion === 'static' ? 'tracking' : wrong,
          quality: 0.5 + 0.45 * next(),
          frames: 240 + Math.floor(next() * 240),
          capturedAt: 1_700_000_000_000 + Math.floor(next() * 1e8),
          faceCount: 0,
        }),
      );
  });
  for (let index = 0; index < def.distractors; index++)
    profiles.push(
      makeProfile({
        embedding: unitVector(def.seed * 104_729 + index),
        motionClass: CAMERA_MOTIONS[Math.floor(next() * CAMERA_MOTIONS.length)] ?? null,
        quality: 0.5 + 0.45 * next(),
        frames: 240 + Math.floor(next() * 240),
        capturedAt: 1_700_000_000_000 + Math.floor(next() * 1e8),
      }),
    );
  const engine = createCastingEngine({ catalog: createMemoryShotCatalog(profiles), embedder: fakeEmbedder(table) });
  return { template, profiles, acceptable, engine };
}
