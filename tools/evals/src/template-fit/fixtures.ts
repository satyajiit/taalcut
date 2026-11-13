// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The synthetic template fit set (LRN1-TPL): a lavfi library (one solid colour per theme, portrait, lossless) whose
 * clips are described in the casting manifest, nine templates (six themes, two mixes, a three-slot cut of the gym
 * theme) and nine footage sets labelled by construction: each theme's clips with a stray clip from another theme, a
 * pool of half one theme and half another (the mix is the right template), three gym clips (the quick cut, which they
 * fill completely, above the four-slot gym template a slot short) and three hike clips (the hike template a slot
 * short, above the quick cut they fill completely but hardly match). Synthetic: never a gate result.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeJson } from '../files';
import { assertLosslessEncode } from '../ffmpeg-run';
import { encodeLavfiClips, type LavfiClip } from '../fixtures/lavfi';
import type { CastingManifest } from '../casting/library';
import { fixtureTemplate } from '../casting/template';
import { TEMPLATES_MANIFEST, type TemplatesManifest } from './library';
import type { FitCase } from './schema';
import { CUTS, cutSlots, MIXES, mixSlots, THEMES, themeOf, type ThemeSlot } from './themes';

export const FIT_FIXTURE_LIBRARY = 'synthetic-fit';
const CLIP_FRAMES = 30;

const clipPath = (theme: string, index: number) => `clips/${theme}-${index + 1}.mkv`;
const templatePath = (key: string) => `templates/${key}.json`;

function templateOf(slots: readonly ThemeSlot[]) {
  return fixtureTemplate(
    slots.map((slot, index) => ({
      frames: slot.frames,
      intent: slot.intent,
      motion: slot.motion,
      energy: 0.3 + index / 10,
    })),
  );
}

/** A solid colour per theme, a clip for each of its clips. */
function lavfiClips(libraryDir: string): LavfiClip[] {
  return THEMES.flatMap((theme) =>
    theme.clips.map((_, index) => ({
      source: `color=c=${theme.color}:s=32x64:r=30:d=1`,
      frames: CLIP_FRAMES,
      path: join(libraryDir, clipPath(theme.key, index)),
    })),
  );
}

function manifest(): CastingManifest {
  return {
    library: FIT_FIXTURE_LIBRARY,
    synthetic: true,
    clips: THEMES.flatMap((theme) =>
      theme.clips.map((clip, index) => ({
        asset: clipPath(theme.key, index),
        frames: CLIP_FRAMES,
        color: theme.color,
        profile: {
          description: clip.description,
          motion: clip.motion,
          faces: clip.faces,
          quality: 0.8,
          place: theme.key,
          capturedAt: `2026-09-0${1 + (index % 4)}T10:00:00Z`,
        },
      })),
    ),
  };
}

function templatesManifest(): TemplatesManifest {
  return {
    library: FIT_FIXTURE_LIBRARY,
    synthetic: true,
    templates: [
      ...THEMES.map((theme) => ({ file: templatePath(theme.key), name: theme.name, tags: [...theme.tags] })),
      ...MIXES.map((mix) => ({ file: templatePath(mix.key), name: mix.name })),
      ...CUTS.map((cut) => ({ file: templatePath(cut.key), name: cut.name })),
    ],
  };
}

const clipsOf = (key: string, count = 4) =>
  themeOf(key)
    .clips.slice(0, count)
    .map((_, index) => clipPath(key, index));

/** The labelled footage sets. */
export function syntheticFitCases(): FitCase[] {
  const base = { library: FIT_FIXTURE_LIBRARY, synthetic: true };
  const strays = ['coffee', 'gym', 'market', 'city', 'hike', 'beach'];
  return [
    ...THEMES.map((theme, index) => ({
      ...base,
      caseId: `${theme.key}-set`,
      pool: [...clipsOf(theme.key), clipPath(strays[index] ?? 'beach', 3)],
      best: templatePath(theme.key),
      note: `${theme.name}'s four clips and one stray`,
    })),
    {
      ...base,
      caseId: 'beach-and-coffee',
      pool: [...clipsOf('beach', 2), ...clipsOf('coffee', 2)],
      best: templatePath('beach-coffee'),
      note: 'Half beach, half coffee: only the mix is filled',
    },
    {
      ...base,
      caseId: 'gym-short',
      pool: clipsOf('gym', 3),
      best: templatePath('gym-quick'),
      note: 'Three of the four gym clips: the quick cut, which they fill completely (Leg day is a slot short)',
    },
    {
      ...base,
      caseId: 'hike-short',
      pool: clipsOf('hike', 3),
      best: templatePath('hike'),
      note: 'Three of the four hike clips: Trail run, a slot short (they fill the gym quick cut but hardly match it)',
    },
  ];
}

/** Writes `<out>/library` (clips, manifest, templates) and `<out>/labels/template-fit/<library>/*.json`. */
export async function writeFitFixtures(
  outDir: string,
  ffmpeg: string,
): Promise<{ libraryDir: string; labelsDir: string }> {
  assertLosslessEncode(
    'evals.template-fit.fixture',
    'Synthetic fit clips are labelled by construction. A lossy encode is not required, and ffv1 keeps the frames exact.',
  );
  const libraryDir = join(outDir, 'library');
  mkdirSync(join(libraryDir, 'clips'), { recursive: true });
  await encodeLavfiClips(ffmpeg, lavfiClips(libraryDir));
  writeJson(join(libraryDir, 'manifest.json'), manifest());
  for (const theme of THEMES) writeJson(join(libraryDir, templatePath(theme.key)), templateOf(theme.slots));
  for (const mix of MIXES) writeJson(join(libraryDir, templatePath(mix.key)), templateOf(mixSlots(mix.from)));
  for (const cut of CUTS) writeJson(join(libraryDir, templatePath(cut.key)), templateOf(cutSlots(cut)));
  writeJson(join(libraryDir, TEMPLATES_MANIFEST), templatesManifest());
  const labelsDir = join(outDir, 'labels', 'template-fit', FIT_FIXTURE_LIBRARY);
  writeJson(join(labelsDir, 'cases.json'), syntheticFitCases());
  return { libraryDir, labelsDir };
}
