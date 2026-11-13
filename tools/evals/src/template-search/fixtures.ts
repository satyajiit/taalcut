// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The synthetic template search set (LRN1-TPL): the template fit set's eight templates (six themes, two mixes) with
 * their names and tags, and fourteen queries labelled by construction: by the name's words, by the template as a
 * whole, and by one slot. A mix is right too when the query is about one of the slots it took. Synthetic: the
 * numbers describe the fusion on made-up templates, never a gate.
 */
import { join } from 'node:path';
import { writeJson } from '../files';
import { fixtureTemplate } from '../casting/template';
import { TEMPLATES_MANIFEST, type TemplatesManifest } from '../template-fit/library';
import { MIXES, mixSlots, THEMES, type ThemeSlot } from '../template-fit/themes';
import type { TemplateQuery, TemplateQueryKind } from './schema';

export const SEARCH_FIXTURE_LIBRARY = 'synthetic-templates';

const file = (key: string) => `templates/${key}.json`;

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

const QUERIES: readonly (readonly [string, TemplateQueryKind, string, readonly string[]])[] = [
  ['beach-day', 'words', 'beach day', ['beach', 'beach-coffee']],
  ['night-market', 'words', 'night market', ['market']],
  ['leg-day', 'words', 'leg day', ['gym', 'gym-hike']],
  ['city-lights', 'words', 'city lights', ['city']],
  ['sea-sunset', 'meaning', 'sunset by the sea with sand and shells', ['beach', 'beach-coffee']],
  ['slow-morning', 'meaning', 'a slow morning in the kitchen with a hot mug', ['coffee', 'beach-coffee']],
  ['food-stalls', 'meaning', 'street food stalls and spices', ['market']],
  ['mountain-run', 'meaning', 'running up a mountain through the forest', ['hike', 'gym-hike']],
  ['chalk-hands', 'slot', 'close up of chalk on hands before lifting', ['gym', 'gym-hike']],
  ['neon-puddle', 'slot', 'neon reflections in a rain puddle', ['city']],
  ['coffee-pour', 'slot', 'coffee pouring into a cup', ['coffee', 'beach-coffee']],
  ['valley-aerial', 'slot', 'aerial view over a green valley', ['hike']],
  ['vendor-food', 'slot', 'vendor handing food to a customer', ['market']],
  ['sand-feet', 'slot', 'feet walking in the sand', ['beach', 'beach-coffee']],
];

export function syntheticTemplateQueries(): TemplateQuery[] {
  return QUERIES.map(([queryId, kind, text, relevant]) => ({
    queryId,
    library: SEARCH_FIXTURE_LIBRARY,
    synthetic: true,
    text,
    kind,
    relevant: relevant.map(file),
  }));
}

/** Writes `<out>/library` (templates/ and templates.json) and `<out>/labels/template-search/<library>/queries.json`. */
export function writeTemplateSearchFixtures(outDir: string): { libraryDir: string; labelsDir: string } {
  const libraryDir = join(outDir, 'library');
  for (const theme of THEMES) writeJson(join(libraryDir, file(theme.key)), templateOf(theme.slots));
  for (const mix of MIXES) writeJson(join(libraryDir, file(mix.key)), templateOf(mixSlots(mix.from)));
  const manifest: TemplatesManifest = {
    library: SEARCH_FIXTURE_LIBRARY,
    synthetic: true,
    templates: [
      ...THEMES.map((theme) => ({ file: file(theme.key), name: theme.name, tags: [...theme.tags] })),
      ...MIXES.map((mix) => ({ file: file(mix.key), name: mix.name })),
    ],
  };
  writeJson(join(libraryDir, TEMPLATES_MANIFEST), manifest);
  const labelsDir = join(outDir, 'labels', 'template-search', SEARCH_FIXTURE_LIBRARY);
  writeJson(join(labelsDir, 'queries.json'), syntheticTemplateQueries());
  return { libraryDir, labelsDir };
}
