// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fake's sample clips (UX2): clips backed by real files (e2e/sample-media, served at /fake-media/), so the clip
 * page's viewer plays, seeks and scrubs as it does in the app. Like the edge clips they are reachable by id only,
 * kept out of the grid, search and counts. Each is a pipeline state the real library reaches: complete, waiting for
 * on-device models (the PO's two phone clips on 2026-10-22), still making its copy to play, without sound, an
 * original small enough to be its own proxy, and (round 2) its filmstrip being made or failed.
 */
import type { AssetDetail, BeatMap, DerivedFileRef, ShotDetail, TranscriptSegment } from '@taalcut/core';
import { FIXTURE_NOW, KIND, type FakeAsset, type FakeSource } from './assets';
import { SAMPLE_MEDIA, type SampleName } from './sample-media.gen';
import { phoneFacts, phoneSummary } from './sample-phones';
import { SAMPLE_CLIPS, type SampleClip, type SampleState } from './sample-words';
import { fakeHash, fakeUlid } from './seed';

const RATE = { num: 30, den: 1 } as const;
const MS = { num: 1000, den: 1 } as const;
const DAY = 86_400_000;

/** The real pipeline's stages and the finish line each counts toward (library's DEFAULT_STAGE_ORDER, IX). */
const STAGES = [
  ['library.hash', 'searchable'],
  ['media.normalise', 'searchable'],
  ['media.thumbnail', 'searchable'],
  ['vision.shots', 'searchable'],
  ['vision.analyse', 'searchable'],
  ['vision.ocr', 'searchable'],
  ['vision.embed', 'searchable'],
  ['vision.embedOcr', 'searchable'],
  ['audio.language', 'searchable'],
  ['audio.transcript', 'searchable'],
  ['vision.embedText', 'searchable'],
  ['media.proxy', 'complete'],
  ['media.filmstrip', 'complete'],
  ['media.previews', 'complete'],
  ['vision.describe', 'complete'],
] as const;
type Stage = (typeof STAGES)[number][0];
type Row = AssetDetail['stages'][number];

/** The stages that wait for an on-device model the Mac doesn't have, as the PO's library showed them. */
const NEEDS_MODEL: ReadonlySet<Stage> = new Set([
  'audio.language',
  'vision.describe',
  'vision.embed',
  'vision.embedOcr',
  'vision.embedText',
]);
const DONE_BEFORE_MODELS: ReadonlySet<Stage> = new Set([
  'library.hash',
  'media.normalise',
  'media.thumbnail',
  'media.previews',
  'media.proxy',
  'media.filmstrip',
  'vision.shots',
  'vision.analyse',
]);

/** The filmstrip that failed, as media says it (the clip's sample state `filmstripFailed`). */
const DECODE_FAILED = {
  code: 'media.decode_failed',
  messageKey: 'errors.media.decode_failed',
  retryable: false,
} as const;

const WHISPER_MISSING = {
  code: 'audio.model_missing',
  messageKey: 'errors.audio.model_missing',
  params: { component: 'whisper-tiny' },
  retryable: false,
} as const;

function row(stage: Stage, milestone: Row['milestone'], state: SampleState): Row {
  const at = { stage, milestone };
  if (state === 'waitingForModels') {
    if (DONE_BEFORE_MODELS.has(stage)) return { ...at, state: 'done' };
    if (!NEEDS_MODEL.has(stage)) return { ...at, state: 'waiting' };
    const held: Row = { ...at, state: 'waiting', reasonKey: 'library.stage.modelMissing' };
    // As the library holds it: the listening job ran and named the model it found missing; the embedding steps
    // are held before they run and name none (features/downloads/stage-models.ts knows theirs).
    return stage === 'audio.language' ? { ...held, error: WHISPER_MISSING } : held;
  }
  if (state === 'preparing') {
    if (stage === 'media.proxy') return { ...at, state: 'running' };
    return ['library.hash', 'media.normalise', 'media.thumbnail'].includes(stage)
      ? { ...at, state: 'done' }
      : { ...at, state: 'waiting' };
  }
  if (state === 'makingFilmstrip' && stage === 'media.filmstrip') return { ...at, state: 'running' };
  if (state === 'makingFilmstrip' && stage === 'media.previews') return { ...at, state: 'waiting' };
  if (state === 'filmstripFailed' && stage === 'media.filmstrip')
    return { ...at, state: 'failed', error: DECODE_FAILED };
  if (state === 'silent' && (stage.startsWith('audio.') || stage === 'vision.embedText'))
    return { ...at, state: 'skipped', reasonKey: 'indexing.skip.noAudio' };
  return { ...at, state: 'done' };
}

function stagesOf(clip: SampleClip): Row[] {
  // In pipeline order, as the library sends them.
  return STAGES.map(([stage, milestone]) => row(stage, milestone, clip.state));
}

const done = (stages: readonly Row[], stage: Stage) =>
  stages.some((s) => s.stage === stage && s.state === 'done');

/** A derived file of the sample's own: its key names the file the fake serves (fake-media.ts). */
function sampleRef(
  clip: SampleClip,
  kind: 'proxy' | 'thumbnail' | 'filmstrip',
  file: string,
  size: { w: number; h: number },
) {
  const hash = fakeHash(clip.n, kind === 'proxy' ? 7 : kind === 'thumbnail' ? 8 : 9);
  const folder = { proxy: 'proxies', thumbnail: 'thumbnails', filmstrip: 'filmstrips' }[kind];
  // media's filmstrip is recipe 2 (UX2, round 2); the rest are recipe 1.
  const recipe = kind === 'filmstrip' ? 2 : 1;
  const bytes = {
    proxy: SAMPLE_MEDIA[clip.media].bytes,
    thumbnail: 4_000,
    filmstrip: SAMPLE_MEDIA[clip.media].strip.bytes,
  };
  return {
    kind,
    key: `${folder}/${hash.slice(0, 2)}/${hash}.sample-${file}.v${recipe}.${kind === 'proxy' ? 'mp4' : 'jpg'}`,
    bytes: bytes[kind],
    mimeType: kind === 'proxy' ? 'video/mp4' : 'image/jpeg',
    width: size.w,
    height: size.h,
    recipe,
  } satisfies DerivedFileRef;
}

function stillSize(media: SampleName) {
  const { width, height } = SAMPLE_MEDIA[media];
  return width > height ? { w: 320, h: 180 } : { w: 180, h: 320 };
}

const id = (clip: SampleClip) => fakeUlid<'Asset'>(KIND.asset, clip.n);

export function sampleClips(sources: readonly FakeSource[]): FakeAsset[] {
  const [phone, , , desktop] = sources;
  if (!phone || !desktop) return [];
  return SAMPLE_CLIPS.map((clip, order) => {
    const media = SAMPLE_MEDIA[clip.media];
    const stages = stagesOf(clip);
    const settled = stages.filter((s) => s.state === 'done' || s.state === 'skipped').length;
    const added = FIXTURE_NOW - (order + 1) * 3_600_000;
    const searchable = stages.filter((s) => s.milestone === 'searchable').every((s) => s.state !== 'waiting');
    return {
      summary: {
        id: id(clip),
        kind: 'video',
        name: clip.name,
        ...phoneSummary(clip, added - DAY),
        addedAt: added,
        duration: { value: media.frames, rate: RATE },
        width: clip.original.width,
        height: clip.original.height,
        orientation: clip.original.width > clip.original.height ? 'landscape' : 'portrait',
        availability: 'online',
        sourceIds: [clip.device.make === 'Apple' ? phone.id : desktop.id],
        description: done(stages, 'vision.describe') ? clip.description : null,
        quality: done(stages, 'vision.analyse') ? 0.82 : null,
        shotCount: done(stages, 'vision.shots') ? clip.shots.length : 0,
        language: clip.lines.length > 0 && done(stages, 'audio.transcript') ? 'en' : null,
        index: {
          state: stages.some((s) => s.state === 'failed')
            ? 'failed'
            : settled === stages.length
              ? 'done'
              : stages.some((s) => s.state === 'running')
                ? 'indexing'
                : 'waiting',
          done: settled,
          total: stages.length,
          searchableAt: searchable ? added + 60_000 : null,
        },
        thumbnail: sampleRef(clip, 'thumbnail', clip.media, stillSize(clip.media)),
        reencode: null,
        trashed: false,
        provenance: { kind: 'captured' },
      },
      extras: { n: clip.n, scene: 0, speech: null, frameRate: RATE },
    };
  });
}

const clipOf = (n: number) => SAMPLE_CLIPS.find((clip) => clip.n === n);

/** The sample whose original is its own proxy, by asset id: the fake plays its file for app://media/originals. */
export function sampleOriginal(assetId: string): SampleName | null {
  const clip = SAMPLE_CLIPS.find((each) => id(each) === assetId && each.state === 'ownProxy');
  return clip ? clip.media : null;
}

function shotsOf(
  clip: SampleClip,
  stages: readonly Row[],
  assetId: AssetDetail['asset']['id'],
): ShotDetail[] {
  if (!done(stages, 'vision.shots')) return [];
  const described = done(stages, 'vision.describe');
  const reading = done(stages, 'vision.ocr');
  const portrait = SAMPLE_MEDIA[clip.media].height > SAMPLE_MEDIA[clip.media].width;
  return clip.shots.map((shot, index) => {
    const [start, frames] = SAMPLE_MEDIA[clip.media].shots[index] ?? [0, 1];
    const range = { start: { value: start, rate: RATE }, duration: { value: frames, rate: RATE } };
    return {
      id: fakeUlid<'Shot'>(KIND.shot, clip.n * 16 + index),
      assetId,
      index,
      range,
      description: described ? shot.description : null,
      shotType: described ? shot.shotType : null,
      motion: shot.motion,
      quality: 0.82,
      bestTake: true,
      thumbnail: sampleRef(clip, 'thumbnail', `${clip.media}-${index + 1}`, stillSize(clip.media)),
      analysis: {
        version: 1,
        range,
        bestFrame: Math.floor(frames / 2),
        orientation: portrait ? 'portrait' : 'landscape',
        quality: { version: 1, sharpness: 0.84, exposure: 0.8, stability: 0.78, overall: 0.82, flags: [] },
        motion: shot.motion,
        energy: 0.4 + index * 0.1,
        onScreenText:
          reading && shot.text
            ? [
                {
                  text: shot.text,
                  box: { x: 0.1, y: 0.7, width: 0.8, height: 0.08 },
                  range,
                  confidence: 0.95,
                  script: 'latin',
                  reveal: 'none',
                },
              ]
            : [],
        dHash: fakeHash(clip.n, index).slice(0, 16),
        ...(described
          ? {
              description: {
                text: shot.description,
                objects: [...shot.objects],
                ...(clip.place ? { place: clip.place.name } : {}),
                shotType: shot.shotType,
                people: shot.people ?? 0,
                model: { provider: 'local', model: 'qwen3-vl-4b', local: true },
              },
            }
          : { descriptionSkipped: 'not_yet' as const }),
      },
      transcriptText: null,
      duplicateGroup: null,
    };
  });
}

/** The sample's speech as the library pages it: segments with each word's time. */
export function sampleTranscript(n: number): { language: string; segments: TranscriptSegment[] } | null {
  const clip = clipOf(n);
  if (!clip || clip.lines.length === 0 || clip.state === 'waitingForModels' || clip.state === 'preparing')
    return null;
  return {
    language: 'en',
    segments: clip.lines.map(([text, from, to]) => {
      const words = text.split(/\s+/);
      const step = ((to - from) * 1000) / words.length;
      return {
        text,
        language: 'en',
        range: { start: { value: from * 1000, rate: MS }, duration: { value: (to - from) * 1000, rate: MS } },
        words: words.map((word, w) => ({
          text: word,
          range: {
            start: { value: Math.round(from * 1000 + w * step), rate: MS },
            duration: { value: Math.round(step * 0.9), rate: MS },
          },
          confidence: 0.94,
        })),
      };
    }),
  };
}

function beatsOf(clip: SampleClip): BeatMap | null {
  if (!clip.beats) return null;
  const ms = Math.round((SAMPLE_MEDIA[clip.media].frames / RATE.num) * 1000);
  const beats = Array.from({ length: Math.floor(ms / 500) }, (_, i) => ({ value: i * 500, rate: MS }));
  return {
    rate: MS,
    beats,
    downbeats: beats.map((_, i) => i).filter((i) => i % 4 === 0),
    bpm: 120,
    beatsPerBar: 4,
    confidence: 0.86,
    source: 'tracker',
  };
}

function playbackOf(clip: SampleClip, stages: readonly Row[]): AssetDetail['playback'] {
  if (!done(stages, 'media.proxy')) return null;
  const media = SAMPLE_MEDIA[clip.media];
  const duration = { value: media.frames, rate: RATE };
  if (clip.state === 'ownProxy')
    return {
      source: 'original',
      width: clip.original.width,
      height: clip.original.height,
      duration,
      frameRate: RATE,
    };
  const file = sampleRef(clip, 'proxy', clip.media, { w: media.width, h: media.height });
  return { source: 'proxy', file: { ...file, duration, frameRate: RATE } };
}

/** media.filmstrip's sprite of the sample (e2e/sample-media/<media>-strip.jpg), once the stage made it. */
function filmstripOf(clip: SampleClip, stages: readonly Row[]): AssetDetail['filmstrip'] {
  if (!done(stages, 'media.filmstrip')) return null;
  const { strip } = SAMPLE_MEDIA[clip.media];
  const size = { w: strip.columns * strip.tileWidth, h: strip.rows * strip.tileHeight };
  return {
    file: sampleRef(clip, 'filmstrip', `${clip.media}-strip`, size),
    columns: strip.columns,
    rows: strip.rows,
    tileWidth: strip.tileWidth,
    tileHeight: strip.tileHeight,
    times: strip.frames.map((value) => ({ value, rate: RATE })),
  };
}

/** A sample's detail in full, from its files and words; null for any other clip. */
export function sampleDetail(asset: FakeAsset, source: FakeSource): AssetDetail | null {
  const clip = clipOf(asset.extras.n);
  if (!clip) return null;
  const stages = stagesOf(clip);
  const media = SAMPLE_MEDIA[clip.media];
  const transcript = sampleTranscript(clip.n);
  const sound = media.peaks !== null;
  const { summary } = asset;
  return {
    asset: summary,
    facts: {
      version: 1,
      width: clip.original.width,
      height: clip.original.height,
      orientation: summary.orientation ?? 'portrait',
      duration: { value: media.frames, rate: RATE },
      frameRate: RATE,
      variableFrameRate: false,
      hdr: clip.original.hdr,
      speed: 'normal',
      speedFactor: 1,
      retimedInFile: false,
      hasAudio: sound,
      videoCodec: clip.original.codec,
      ...(sound ? { audioCodec: 'aac' } : {}),
      bitDepth: clip.original.bitDepth,
      ...phoneFacts(clip, summary),
      ...(clip.place ? { location: { latitude: clip.place.latitude, longitude: clip.place.longitude } } : {}),
    },
    shots: shotsOf(clip, stages, summary.id),
    transcript: transcript
      ? {
          language: 'en',
          lines: transcript.segments.map(({ text, range }) => ({ text, range })),
          truncated: false,
        }
      : null,
    locations: [
      {
        id: fakeUlid<'AssetLocation'>(KIND.location, clip.n),
        sourceId: source.id,
        sourceName: source.name,
        storage: source.kind === 'wifi_import' ? 'managed' : 'referenced',
        state: 'present',
        relativePath: clip.name,
        volumeName: source.volume,
      },
    ],
    reencodeReasons: [],
    stages,
    playback: playbackOf(clip, stages),
    filmstrip: filmstripOf(clip, stages),
    waveform:
      sound && done(stages, 'media.previews')
        ? { bucketsPerSecond: 50, peaks: [...(media.peaks ?? [])] }
        : null,
    beats: beatsOf(clip),
    sizeBytes: clip.original.bytes,
  };
}
