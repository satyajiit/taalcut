// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { assertLosslessEncode } from '../ffmpeg-run';
import { writeJson } from '../files';
import { encodeLavfiClips, type LavfiClip } from '../fixtures/lavfi';
import { type CastingManifest } from './library';
import { type CastingCase } from './schema';
import { fixtureTemplate, type FixtureSlot } from './template';

export const CASTING_FIXTURE_LIBRARY = 'synthetic-cast';

type Clip = CastingManifest['clips'][number] & {
  readonly file: string;
  readonly color: string;
  readonly frames: number;
  readonly source: 'color' | 'pan' | 'testsrc2';
};

/**
 * Six portrait clips: four labelled acceptable (one per slot) and two
 * distractors. `profile` is what vision would have written about each; the
 * casting adapter embeds the description with its deterministic embedder.
 */
const CLIPS: readonly Clip[] = [
  {
    file: 'arrival.mkv',
    asset: 'clips/arrival.mkv',
    color: 'red',
    frames: 30,
    source: 'color',
    profile: {
      description: 'wide shot of travellers arriving in a red hall, static camera',
      motion: 'static',
      faces: 2,
      quality: 0.85,
      place: 'hall',
      capturedAt: '2026-05-01T09:00:00Z',
    },
  },
  {
    file: 'beach.mkv',
    asset: 'clips/beach.mkv',
    color: 'blue',
    frames: 20,
    source: 'pan',
    profile: {
      description: 'wide shot of a blue beach and the water, slow pan',
      motion: 'pan',
      faces: 0,
      quality: 0.8,
      place: 'beach',
      capturedAt: '2026-05-01T11:00:00Z',
    },
  },
  {
    file: 'step.mkv',
    asset: 'clips/step.mkv',
    color: 'green',
    frames: 15,
    source: 'testsrc2',
    profile: {
      description: 'close up detail of green steps, handheld',
      motion: 'handheld',
      faces: 0,
      quality: 0.75,
      place: 'steps',
      capturedAt: '2026-05-01T14:00:00Z',
    },
  },
  {
    file: 'end.mkv',
    asset: 'clips/end.mkv',
    color: 'yellow',
    frames: 10,
    source: 'color',
    profile: {
      description: 'close up of a yellow sunset at the end of the day',
      motion: 'static',
      faces: 0,
      quality: 0.8,
      place: 'beach',
      capturedAt: '2026-05-01T18:30:00Z',
    },
  },
  {
    file: 'market.mkv',
    asset: 'clips/market.mkv',
    color: 'magenta',
    frames: 30,
    source: 'color',
    profile: {
      description: 'close up of a night market stall, handheld',
      motion: 'handheld',
      faces: 1,
      quality: 0.7,
      place: 'market',
      capturedAt: '2026-05-01T21:00:00Z',
    },
  },
  {
    file: 'street.mkv',
    asset: 'clips/street.mkv',
    color: 'gray',
    frames: 30,
    source: 'color',
    profile: {
      description: 'wide shot of a quiet street, static camera',
      motion: 'static',
      faces: 0,
      quality: 0.7,
      place: 'street',
      capturedAt: '2026-05-01T08:00:00Z',
    },
  },
];

export function syntheticCastingCase(): CastingCase {
  return {
    caseId: 'four-slot',
    library: CASTING_FIXTURE_LIBRARY,
    synthetic: true,
    template: { file: 'templates/four-slot.json' },
    slots: [
      {
        slotIndex: 0,
        shotType: 'wide',
        acceptable: [{ asset: 'clips/arrival.mkv', range: { startFrame: 0, endFrame: 30 } }],
      },
      {
        slotIndex: 1,
        shotType: 'wide',
        acceptable: [{ asset: 'clips/beach.mkv', range: { startFrame: 0, endFrame: 20 } }],
      },
      {
        slotIndex: 2,
        shotType: 'close',
        acceptable: [{ asset: 'clips/step.mkv', range: { startFrame: 0, endFrame: 15 } }],
      },
      {
        slotIndex: 3,
        shotType: 'close',
        acceptable: [{ asset: 'clips/end.mkv', range: { startFrame: 0, endFrame: 10 } }],
      },
    ],
    order: {
      groups: {
        arrival: [{ asset: 'clips/arrival.mkv', range: { startFrame: 0, endFrame: 30 } }],
        beach: [{ asset: 'clips/beach.mkv', range: { startFrame: 0, endFrame: 20 } }],
      },
      rules: [{ before: 'arrival', after: 'beach' }],
    },
  };
}

/** The four-slot template's slots, each intent written the way the Analyst writes one. */
export const CASTING_FIXTURE_SLOTS: readonly FixtureSlot[] = [
  {
    frames: 15,
    intent: 'wide establishing shot of people arriving in the hall',
    motion: 'static',
    energy: 0.6,
  },
  { frames: 15, intent: 'wide shot of the beach and the water, camera pans', motion: 'pan', energy: 0.5 },
  { frames: 12, intent: 'close detail of the steps, handheld', motion: 'handheld', energy: 0.7 },
  { frames: 10, intent: 'close up of the sunset to end the day', motion: 'static', energy: 0.3 },
];

/** The four-slot template, written the way the Analyst writes intents. */
export function syntheticCastingTemplate() {
  return fixtureTemplate(CASTING_FIXTURE_SLOTS);
}

/** The clip's lavfi source; the pan is a tall colour field cropped one row further down each frame. */
function lavfiClip(clip: Clip, libraryDir: string): LavfiClip {
  const at = { frames: clip.frames, path: join(libraryDir, 'clips', clip.file) };
  if (clip.source === 'testsrc2') return { ...at, source: 'testsrc2=size=32x64:rate=30:duration=1' };
  if (clip.source === 'pan')
    return {
      ...at,
      source: `color=c=${clip.color}:s=32x128:r=30:d=1`,
      filter: 'crop=32:64:x=0:y=min(n\\,64)',
    };
  return { ...at, source: `color=c=${clip.color}:s=32x64:r=30:d=1` };
}

/** Lavfi library (solid colours, one pan, one testsrc2; portrait), a real Template v1 and a 4-slot labelled case. */
export async function writeCastingFixtures(
  outDir: string,
  ffmpeg: string,
): Promise<{ libraryDir: string; labelsDir: string }> {
  assertLosslessEncode(
    'evals.casting.fixture',
    'Synthetic casting clips are labelled by construction. A lossy encode is not required, and ffv1 keeps the frames exact.',
  );
  const libraryDir = join(outDir, 'library');
  mkdirSync(join(libraryDir, 'clips'), { recursive: true });
  mkdirSync(join(libraryDir, 'templates'), { recursive: true });
  await encodeLavfiClips(
    ffmpeg,
    CLIPS.map((clip) => lavfiClip(clip, libraryDir)),
  );
  writeJson(join(libraryDir, 'templates', 'four-slot.json'), syntheticCastingTemplate());
  const manifest: CastingManifest = {
    library: CASTING_FIXTURE_LIBRARY,
    synthetic: true,
    clips: CLIPS.map(({ asset, frames, color, profile }) => ({
      asset,
      frames,
      color,
      ...(profile ? { profile } : {}),
    })),
  };
  writeJson(join(libraryDir, 'manifest.json'), manifest);
  const labelsDir = join(outDir, 'labels', 'casting', CASTING_FIXTURE_LIBRARY);
  mkdirSync(labelsDir, { recursive: true });
  writeJson(join(labelsDir, 'four-slot.json'), syntheticCastingCase());
  return { libraryDir, labelsDir };
}
