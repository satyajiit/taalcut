// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A generated library of 200 profiled assets (no media files): facts, shots
 * with analyses and descriptions, transcripts in the four v1 languages,
 * thumbnails, stage states, near-duplicate pairs and, given a vector index,
 * the vectors vision would write (from the fake embedder). Built through the
 * repositories, so it exercises the real write paths. Deterministic.
 */
import { createHash } from 'node:crypto';
import {
  RationalTime,
  TimeRange,
  unwrap,
  type AssetId,
  type MediaFacts,
  type ShotAnalysis,
  type ShotId,
  type SourceId,
  type Transcript,
  type VectorIndex,
  type VectorItem,
} from '@taalcut/core';
import { createRepositories, type LibraryDatabase } from '../../src/index';
import { embedText } from './fake-embedder';
import { LANGUAGES, THEMES, type FixtureLanguage, type Theme } from './library-themes';

export const FIXTURE_ASSETS = 200;

export interface LabelledQuery {
  readonly query: string;
  readonly language: FixtureLanguage;
  readonly theme: string;
  /** The shots a person would call relevant: every shot of the theme. */
  readonly relevant: readonly ShotId[];
}

export interface FixtureLibrary {
  readonly assets: readonly AssetId[];
  readonly sources: readonly SourceId[];
  readonly themeOf: ReadonlyMap<AssetId, string>;
  readonly languageOf: ReadonlyMap<AssetId, FixtureLanguage>;
  readonly shotsByTheme: ReadonlyMap<string, readonly ShotId[]>;
  /** One query per theme and language (40): the synthetic stand-in for the P2-Q1 labels. */
  readonly queries: readonly LabelledQuery[];
}

const RATES = [
  { num: 30000, den: 1001 },
  { num: 25, den: 1 },
  { num: 24, den: 1 },
];
const START = Date.UTC(2025, 9, 1);
const DAY = 86_400_000;

/** Distinct, stable hex digits per number (stand-ins for content hashes and dHashes). */
const hex = (n: number, length: number) =>
  createHash('sha256').update(`fixture:${n}`).digest('hex').slice(0, length);

function kindOf(i: number): 'video' | 'image' | 'audio' {
  const slot = (i * 7) % 20;
  return slot < 15 ? 'video' : slot < 19 ? 'image' : 'audio';
}

function facts(i: number, kind: string, duration: RationalTime | null): MediaFacts {
  const portrait = i % 2 === 0;
  const at = new Date(START + i * DAY * 1.7).toISOString().slice(0, 19);
  return {
    version: 1,
    width: portrait ? 1080 : 1920,
    height: portrait ? 1920 : 1080,
    orientation: i % 11 === 0 ? 'square' : portrait ? 'portrait' : 'landscape',
    ...(duration ? { duration } : {}),
    ...(kind === 'video' ? { frameRate: duration!.rate } : {}),
    variableFrameRate: false,
    hdr: 'none',
    speed: 'normal',
    speedFactor: 1,
    retimedInFile: false,
    hasAudio: kind !== 'image',
    captureTime: `${at}+05:30`,
    device: { make: 'Apple', model: 'iPhone 17 Pro' },
  };
}

function analysis(theme: Theme, i: number, n: number, range: TimeRange): ShotAnalysis {
  const quality = 0.3 + ((i * 3 + n) % 7) / 10;
  return {
    version: 1,
    range,
    bestFrame: 0,
    orientation: i % 2 === 0 ? 'portrait' : 'landscape',
    quality: { version: 1, sharpness: quality, exposure: 0.8, stability: 0.7, overall: quality, flags: [] },
    motion: theme.motion,
    energy: ((i + n) % 10) / 10,
    onScreenText: theme.onScreen
      ? [
          {
            text: theme.onScreen,
            box: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 },
            range,
            confidence: 0.9,
            script: /[ऀ-ॿ]/.test(theme.onScreen) ? 'devanagari' : 'latin',
            reveal: 'none',
          },
        ]
      : [],
    dHash: hex(i * 31 + n, 16),
    description: {
      text: theme.description,
      objects: [...theme.objects],
      place: theme.place,
      shotType: theme.shotType,
      model: { provider: 'fixture', model: 'fixture-vlm', local: true },
    },
  };
}

function transcript(theme: Theme, language: FixtureLanguage, length: RationalTime): Transcript {
  const ms = Math.max(1000, Math.floor(RationalTime.toSeconds(length) * 1000));
  const words = theme.speech[language].split(' ');
  const step = Math.floor(ms / (words.length + 1));
  const at = (value: number) => RationalTime.of(value, { num: 1000, den: 1 });
  return {
    version: 1,
    language,
    engine: language === 'hi' ? 'whisper' : 'parakeet',
    model: 'fixture-asr',
    local: true,
    wordTiming: 'native',
    segments: [
      {
        text: theme.speech[language],
        range: TimeRange.of(at(0), at(step * words.length)),
        language,
        words: words.map((text, w) => ({ text, range: TimeRange.of(at(w * step), at(step)) })),
      },
    ],
  };
}

/** Builds the library in `db`; with `vectors`, also the vectors vision would write. */
export function buildFixtureLibrary(
  db: LibraryDatabase,
  options: { vectors?: VectorIndex } = {},
): FixtureLibrary {
  // One transaction (one fsync) for the whole library: the writes inside join it as savepoints.
  return db.transaction(() => build(db, options));
}

function build(db: LibraryDatabase, options: { vectors?: VectorIndex }): FixtureLibrary {
  const repos = createRepositories(db);
  const source = (name: string, kind: 'watched_folder' | 'wifi_import') =>
    unwrap(repos.sources.add({ kind, displayName: name, rootPath: `/Users/test/Movies/${name}` })).id;
  const sources = [
    source('Goa trip', 'watched_folder'),
    source('Diwali 2025', 'watched_folder'),
    source('iPhone', 'wifi_import'),
  ];
  const assets: AssetId[] = [];
  const themeOf = new Map<AssetId, string>();
  const languageOf = new Map<AssetId, FixtureLanguage>();
  const shotsByTheme = new Map<string, ShotId[]>(THEMES.map((t) => [t.key, []]));
  const vectors: VectorItem[] = [];
  const pairs: ShotId[][] = [];
  const stage = db.driver.prepare(
    `INSERT INTO asset_index_stages (asset_id, stage, state, version, updated_at, started_at, finished_at)
     VALUES (?, ?, ?, 1, ?, ?, ?)`,
  );

  for (let i = 0; i < FIXTURE_ASSETS; i++) {
    const theme = THEMES[i % THEMES.length]!;
    const language = LANGUAGES[Math.floor(i / THEMES.length) % LANGUAGES.length]!;
    const kind = kindOf(i);
    const rate = RATES[i % RATES.length]!;
    const sourceId = sources[i % sources.length]!;
    const duration =
      kind === 'image' ? null : RationalTime.of(Math.round((6 + (i % 9)) * (rate.num / rate.den)), rate);
    const asset = unwrap(
      repos.assets.create({
        kind,
        sizeBytes: 1_000_000 + i * 1013,
        originalFilename: `${theme.key}-${String(i).padStart(3, '0')}.${kind === 'video' ? 'mov' : kind === 'image' ? 'heic' : 'm4a'}`,
        contentHash: hex(i + 1, 64),
        partialHash: hex(i + 7, 32),
      }),
    );
    unwrap(
      repos.assetLocations.add({
        assetId: asset.id,
        sourceId,
        storage: sourceId === sources[2] ? 'managed' : 'referenced',
        relativePath: `${theme.key}/${asset.originalFilename}`,
        sizeBytes: asset.sizeBytes,
        state: i % 50 === 49 ? 'offline' : 'present',
      }),
    );
    unwrap(repos.assets.setFacts(asset.id, facts(i, kind, duration)));
    if (kind !== 'image') unwrap(repos.assets.setLanguage(asset.id, language));
    unwrap(
      repos.derivedFiles.put(asset.id, [
        {
          kind: 'thumbnail',
          key: `thumbnails/${hex(i, 2)}/${hex(i + 1, 64)}.v1.jpg`,
          bytes: 20_000,
          mimeType: 'image/jpeg',
          width: 320,
          height: 320,
          recipe: 1,
        },
      ]),
    );
    const zero = RationalTime.of(0, { num: 1, den: 1 });
    const count = kind === 'video' ? 1 + (i % 3) : kind === 'image' ? 1 : 0;
    const ranges = Array.from({ length: count }, (_, n) =>
      kind === 'image'
        ? TimeRange.of(zero, zero)
        : TimeRange.of(
            RationalTime.of(Math.floor((duration!.value * n) / count), rate),
            RationalTime.of(Math.floor(duration!.value / count), rate),
          ),
    );
    const shotIds = unwrap(repos.shots.replaceForAsset(asset.id, 0, ranges));
    unwrap(
      repos.shots.putAnalyses(
        shotIds.map((shotId, n) => ({ shotId, analysis: analysis(theme, i, n, ranges[n]!) })),
      ),
    );
    if (kind !== 'image') unwrap(repos.transcripts.put(asset.id, transcript(theme, language, duration!), 0));
    const now = db.clock();
    const failed = i % 40 === 39;
    for (const [s, name] of ['library.hash', 'media.normalise', 'vision.analyse'].entries())
      stage.run(
        asset.id,
        name,
        failed && s === 2 ? 'failed' : i % 25 === 24 && s === 2 ? 'waiting' : 'done',
        now,
        now - 1000,
        now,
      );
    shotsByTheme.get(theme.key)!.push(...shotIds);
    if (i >= THEMES.length && i < THEMES.length * 3 && shotIds[0]) {
      const earlier = shotsByTheme.get(theme.key)!.find((id) => !shotIds.includes(id));
      if (earlier && pairs.length < 5) pairs.push([earlier, shotIds[0]]);
    }
    for (const [n, shotId] of shotIds.entries()) {
      const metadata = { assetId: asset.id, sourceId, kind: 'frame' };
      vectors.push({
        id: `frame:${shotId}:0`,
        vector: embedText(theme.description, 0.6, i * 10 + n),
        metadata,
      });
      vectors.push({
        id: `description:${shotId}`,
        vector: embedText(theme.description),
        metadata: { ...metadata, kind: 'description' },
      });
      if (theme.onScreen)
        vectors.push({
          id: `ocr:${shotId}:0`,
          vector: embedText(theme.onScreen),
          metadata: { ...metadata, kind: 'ocr' },
        });
    }
    if (kind !== 'image')
      vectors.push({
        id: `transcript:${asset.id}:0`,
        vector: embedText(theme.speech[language]),
        metadata: { assetId: asset.id, sourceId, kind: 'transcript' },
      });
    assets.push(asset.id);
    themeOf.set(asset.id, theme.key);
    languageOf.set(asset.id, language);
  }
  unwrap(repos.shots.setDuplicateGroups(pairs.map((shotIds) => ({ shotIds, bestShotId: shotIds[1]! }))));
  if (options.vectors) unwrap(options.vectors.upsert(vectors));
  const queries = THEMES.flatMap((theme) =>
    LANGUAGES.map((language) => ({
      query: theme.queries[language],
      language,
      theme: theme.key,
      relevant: shotsByTheme.get(theme.key)!,
    })),
  );
  return { assets, sources, themeOf, languageOf, shotsByTheme, queries };
}
