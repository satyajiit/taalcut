// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { type SyntheticClip } from '../adapters/synthetic-search';
import { assertLosslessEncode, runFfmpeg } from '../ffmpeg-run';
import { writeJson } from '../files';
import { paintWord } from './font';
import { type SearchQueryLabel } from './schema';

export const SEARCH_FIXTURE_LIBRARY = 'synthetic-search';

const WIDTH = 64;
const HEIGHT = 32;
const FRAMES = 5;

/** 12 clips: two query words per language, plus four distractors. */
const WORDS: {
  asset: string;
  word: string;
  query?: { id: string; language: SearchQueryLabel['language']; text: string };
}[] = [
  {
    asset: 'clips/en-market.mkv',
    word: 'market',
    query: { id: 'en-market', language: 'en', text: 'the market stall' },
  },
  {
    asset: 'clips/en-street.mkv',
    word: 'street',
    query: { id: 'en-street', language: 'en', text: 'a busy street' },
  },
  {
    asset: 'clips/hi-namaste.mkv',
    word: 'namaste',
    query: { id: 'hi-namaste', language: 'hi', text: 'namaste greeting' },
  },
  {
    asset: 'clips/hi-bazaar.mkv',
    word: 'bazaar',
    query: { id: 'hi-bazaar', language: 'hi', text: 'bazaar lane' },
  },
  {
    asset: 'clips/es-playa.mkv',
    word: 'playa',
    query: { id: 'es-playa', language: 'es', text: 'en la playa' },
  },
  {
    asset: 'clips/es-mercado.mkv',
    word: 'mercado',
    query: { id: 'es-mercado', language: 'es', text: 'el mercado' },
  },
  {
    asset: 'clips/pt-praia.mkv',
    word: 'praia',
    query: { id: 'pt-praia', language: 'pt-BR', text: 'na praia' },
  },
  {
    asset: 'clips/pt-festa.mkv',
    word: 'festa',
    query: { id: 'pt-festa', language: 'pt-BR', text: 'a festa' },
  },
  { asset: 'clips/noise.mkv', word: 'noise' },
  { asset: 'clips/blank.mkv', word: 'blank' },
  { asset: 'clips/color.mkv', word: 'color' },
  { asset: 'clips/desk.mkv', word: 'desk' },
];

export function syntheticSearchClips(): SyntheticClip[] {
  return WORDS.map((item) => ({
    asset: item.asset,
    word: item.word,
    frames: FRAMES,
    orientation: 'landscape',
    quality: 0.9,
    captured: '2026-01-15',
  }));
}

export function syntheticSearchQueries(): SearchQueryLabel[] {
  return WORDS.flatMap((item) => {
    if (item.query === undefined) return [];
    return [
      {
        queryId: item.query.id,
        language: item.query.language,
        library: SEARCH_FIXTURE_LIBRARY,
        text: item.query.text,
        relevant: [{ asset: item.asset, range: { startFrame: 0, endFrame: FRAMES } }],
        synthetic: true,
      },
    ];
  });
}

/**
 * Writes the 12-clip library and `labels/search/<library>.json`. Returns the library directory. One FFmpeg run
 * writes every clip: its input is each word's frames in turn, and each output trims its own five. (A run per clip
 * was twelve process starts, which on a busy machine took seconds each. UX2 round 2.)
 */
export async function writeSearchFixtures(
  outDir: string,
  ffmpeg: string,
): Promise<{ libraryDir: string; labelsDir: string }> {
  assertLosslessEncode(
    'evals.search.fixture',
    'Synthetic search clips burn a bitmap word. Lossy H.264 would change the letters.',
  );
  const libraryDir = join(outDir, 'library');
  const clipDir = join(libraryDir, 'clips');
  mkdirSync(clipDir, { recursive: true });
  const painted = paintWord('market');
  const raw = Buffer.concat(
    WORDS.flatMap((item) => {
      const frame = paintWord(item.word);
      return Array.from({ length: FRAMES }, () => frame);
    }),
  );
  const outputs = WORDS.flatMap((item, index) => [
    ...[
      '-map',
      '0:v',
      '-vf',
      `trim=start_frame=${index * FRAMES}:end_frame=${(index + 1) * FRAMES},setpts=PTS-STARTPTS`,
    ],
    ...['-c:v', 'ffv1', '-an', join(libraryDir, item.asset)],
  ]);
  await runFfmpeg(
    ffmpeg,
    [
      ...['-y', '-hide_banner', '-loglevel', 'error'],
      ...['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${WIDTH}x${HEIGHT}`, '-r', '30', '-i', 'pipe:0'],
      ...outputs,
    ],
    raw,
  );
  if (!painted.includes(255)) throw new Error('bitmap font painted no white pixels');
  writeJson(join(libraryDir, 'manifest.json'), {
    library: SEARCH_FIXTURE_LIBRARY,
    synthetic: true,
    width: WIDTH,
    height: HEIGHT,
    clips: syntheticSearchClips(),
  });
  const labelsDir = join(outDir, 'labels', 'search');
  mkdirSync(labelsDir, { recursive: true });
  writeJson(join(labelsDir, `${SEARCH_FIXTURE_LIBRARY}.json`), syntheticSearchQueries());
  return { libraryDir, labelsDir };
}
