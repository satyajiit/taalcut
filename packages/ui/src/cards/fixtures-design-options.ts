// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- made-up model output and on-screen words: data, never translated */

/**
 * DSG2: a title the AI "designed" three ways, made up for /dev/kit, the fake and the tests: three compositions a
 * timeline keeps copies of, the option set a graphic carries (each design's idea and the still kept with the
 * workspace's files), and the card that offers them. They point at the fake's Golden hour market; with the fake's
 * `designs: { arranged: true }` its first video shows the title drawn with the first. Nothing here is a design the
 * app ships or draws: they are records for the picker and its tests.
 */
import type { CardOf, GraphicComposition, GraphicOptions, Id } from '@taalcut/core';
import { DESIGN_FILE_SHAS as SHA, designFile } from './fixtures-design-files';
import { MEDIA_FIXTURE_IDS } from './fixtures-media';
import { at, RUN, T0 } from './fixtures-phase3-ids';

const ulid = <T extends string>(tail: string) => `01K7C5M6Q8R9S0T1V2W3X4${tail}` as Id<T>;
const hex = (pair: string) => pair.repeat(32);

export const DESIGN_OPTION_IDS = {
  compositions: [
    ulid<'GraphicComposition'>('MK11'),
    ulid<'GraphicComposition'>('MK12'),
    ulid<'GraphicComposition'>('MK13'),
  ] as const,
  /** The title the three were designed for. */
  graphic: ulid<'TimelineItem'>('MH11'),
  set: ulid<'GraphicOptionSet'>('MS11'),
  /** Made-up sha256s of each design's still, as the workspace's files name them. */
  stills: [hex('f1'), hex('f2'), hex('f3')] as const,
};

/** The job, in the person's words. */
export const DESIGN_OPTIONS_REQUEST = 'a title for the opening shot';

const WORDS = [
  {
    name: 'Poster headline',
    folder: 'title-a',
    idea: 'A poster: tall condensed capitals off the left edge, led by a short rule.',
  },
  {
    name: 'Quiet caption',
    folder: 'title-b',
    idea: 'A whisper: light lettering in the middle that settles into place.',
  },
  {
    name: 'Corner tag',
    folder: 'title-c',
    idea: 'A label: a rounded paper tag that drops in from the top corner.',
  },
] as const;

const gate: GraphicComposition['gate'] = {
  version: 'hfw1-gate/1',
  passed: true,
  checkedAt: T0,
  hfLint: { errors: 0, warnings: 0 },
  checks: [
    { id: 'hfLint', status: 'pass' },
    { id: 'markup', status: 'pass' },
    { id: 'contrast', status: 'pass' },
    { id: 'bounds', status: 'pass' },
  ],
  loweredTweens: 3,
};

const design = (index: 0 | 1 | 2): GraphicComposition => ({
  id: DESIGN_OPTION_IDS.compositions[index],
  version: 1,
  hash: hex(`a${index + 6}`),
  name: WORDS[index].name,
  entry: `${WORDS[index].folder}/index.html`,
  // The code viewer's sample text: the headline fixture's files under each design's own folder.
  files: [
    designFile(`${WORDS[index].folder}/index.html`, SHA.headlineHtml),
    designFile(`${WORDS[index].folder}/style.css`, SHA.headlineCss),
  ],
  variables: [{ type: 'text', name: 'title', maxLength: 60, sample: 'Golden hour market' }],
  durationSeconds: 2.5,
  provenance: {
    model: { id: 'cloud-designer', onDevice: false },
    overlays: [],
    brief: null,
    request: DESIGN_OPTIONS_REQUEST,
    createdAt: T0,
  },
  gate,
});

/** The three designs, the one to use first, first. */
export const DESIGN_OPTION_COMPOSITIONS: readonly [
  GraphicComposition,
  GraphicComposition,
  GraphicComposition,
] = [design(0), design(1), design(2)];

/** The set the title carries: each design's idea and its still. */
export const DESIGN_OPTIONS_SET: GraphicOptions = {
  set: DESIGN_OPTION_IDS.set,
  request: DESIGN_OPTIONS_REQUEST,
  createdAt: T0,
  designs: WORDS.map((words, index) => ({
    compositionId: DESIGN_OPTION_IDS.compositions[index as 0 | 1 | 2],
    idea: words.idea,
    still: {
      sha256: DESIGN_OPTION_IDS.stills[index as 0 | 1 | 2],
      bytes: 24_000,
      mimeType: 'image/jpeg' as const,
    },
  })),
};

/** Where the title sits on Golden hour's first video, in frames at 30 a second. */
export const DESIGN_OPTIONS_SPAN = { start: 270, length: 75 } as const;

const options = (count: 2 | 3) =>
  WORDS.slice(0, count).map((words, index) => ({
    compositionId: DESIGN_OPTION_IDS.compositions[index as 0 | 1 | 2],
    name: words.name,
    idea: words.idea,
  }));

const card = (id: string, count: 2 | 3): CardOf<'motionGraphic'> => ({
  type: 'motionGraphic',
  version: 1,
  id,
  runId: RUN,
  projectId: MEDIA_FIXTURE_IDS.project,
  timelineId: MEDIA_FIXTURE_IDS.timelines[0],
  itemId: DESIGN_OPTION_IDS.graphic,
  composition: { id: DESIGN_OPTION_IDS.compositions[0], name: WORDS[0].name },
  start: at(DESIGN_OPTIONS_SPAN.start),
  duration: at(DESIGN_OPTIONS_SPAN.length),
  unmatched: [],
  options: options(count),
});

/** The options' cards, as the Designer's place step sends them. */
export const DESIGN_OPTION_FIXTURES: Readonly<Record<string, CardOf<'motionGraphic'>>> = {
  'three designs to choose from': card('design-options', 3),
  'two designs to choose from': card('design-options-two', 2),
};
