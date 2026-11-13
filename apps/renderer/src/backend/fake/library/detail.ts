// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- sample model output and stage names: data, never translated */

/**
 * One clip in full, as library.asset and library.transcript return it: its
 * media facts, shots with their analysis, the transcript with word timings,
 * where the original is and how far indexing got. Derived from the clip's
 * seed, so it is the same every time it is asked for.
 */
import type { AssetDetail, ShotDetail, TranscriptSegment } from '@taalcut/core';
import type { FakeAsset, FakeSource } from './assets';
import { KIND } from './assets';
import { SCENES, SPEECH } from './scenes';
import { fakeHash, fakeUlid, pick, prng, sceneHash } from './seed';
import { doneAfter, FAKE_STAGES, fakeMilestoneOf, type FakeStage } from './stages';

const SHOT_TYPES = ['wide', 'medium', 'close', 'detail', 'pov', 'aerial'] as const;
const MOTIONS = ['static', 'pan', 'tilt', 'push-in', 'pull-out', 'handheld', 'tracking'] as const;

function shotsOf(asset: FakeAsset): ShotDetail[] {
  const { summary, extras } = asset;
  if (summary.shotCount === 0) return [];
  const random = prng(extras.n * 31 + 5);
  const rate = extras.frameRate;
  const frames = summary.duration?.value ?? 1;
  // Cut points spread unevenly, like real footage.
  const weights = Array.from({ length: summary.shotCount }, () => 0.4 + random());
  const sum = weights.reduce((a, b) => a + b, 0);
  let start = 0;
  return weights.map((weight, index) => {
    const last = index === weights.length - 1;
    const length = last ? frames - start : Math.max(1, Math.round((weight / sum) * frames));
    const range = { start: { value: start, rate }, duration: { value: length, rate } };
    start += length;
    // Mostly the clip's own scene; now and then the camera turns to something else.
    const scene = random() < 0.75 ? extras.scene : Math.floor(random() * SCENES.length);
    const words = SCENES[scene]!;
    const shotType = pick(random, SHOT_TYPES);
    const motion = pick(random, MOTIONS);
    const quality =
      summary.quality === null ? null : Math.min(1, Math.max(0.2, summary.quality + (random() - 0.5) * 0.2));
    const hash = sceneHash(scene, extras.n * 16 + index, 2);
    const described = summary.index.done >= doneAfter('vision.describe');
    return {
      id: fakeUlid<'Shot'>(KIND.shot, extras.n * 16 + index),
      assetId: summary.id,
      index,
      range,
      description: described ? words.description : null,
      shotType: described ? shotType : null,
      motion: summary.index.done >= doneAfter('vision.analyse') ? motion : null,
      quality,
      bestTake: index === 0 || random() < 0.5,
      thumbnail: {
        kind: 'thumbnail',
        key: `thumbnails/${hash.slice(0, 2)}/${hash}.v1.jpg`,
        bytes: 16_000,
        mimeType: 'image/jpeg',
        width: (summary.width ?? 1080) / 6,
        height: (summary.height ?? 1920) / 6,
        recipe: 1,
      },
      analysis:
        quality === null
          ? null
          : {
              version: 1,
              range,
              bestFrame: Math.floor(length / 2),
              orientation: summary.orientation ?? 'portrait',
              quality: {
                version: 1,
                sharpness: quality,
                exposure: Math.min(1, quality + 0.05),
                stability: motion === 'handheld' ? quality - 0.15 : quality,
                overall: quality,
                flags: quality < 0.45 ? ['blurry'] : motion === 'handheld' && quality < 0.6 ? ['shaky'] : [],
              },
              motion,
              energy: Math.round(random() * 100) / 100,
              onScreenText: words.onScreenText
                ? [
                    {
                      text: words.onScreenText,
                      box: { x: 0.1, y: 0.72, width: 0.8, height: 0.08 },
                      range,
                      confidence: 0.94,
                      script: 'latin',
                      reveal: 'none',
                    },
                  ]
                : [],
              dHash: fakeHash(extras.n, index).slice(0, 16),
              ...(described
                ? {
                    description: {
                      text: words.description,
                      objects: [...words.objects],
                      ...(words.actions ? { actions: [...words.actions] } : {}),
                      ...(words.place ? { place: words.place } : {}),
                      shotType,
                      people: words.objects.includes('people') || words.objects.includes('person') ? 2 : 0,
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

/** A clip's speech as segments with word timings (ms), in its language. Null without speech. */
export function fakeTranscript(asset: FakeAsset): { language: string; segments: TranscriptSegment[] } | null {
  const { extras, summary } = asset;
  if (extras.speech === null || summary.index.done < doneAfter('audio.transcript')) return null;
  const spoken = SPEECH[extras.speech]!;
  const ms = { num: 1000, den: 1 };
  const totalMs = summary.duration
    ? Math.round((summary.duration.value * summary.duration.rate.den * 1000) / summary.duration.rate.num)
    : 0;
  const random = prng(extras.n * 13 + 3);
  const count = Math.max(1, Math.min(spoken.lines.length, Math.floor(totalMs / 3500)));
  const slot = totalMs / count;
  return {
    language: spoken.language,
    segments: Array.from({ length: count }, (_, index) => {
      const text = spoken.lines[(index + extras.n) % spoken.lines.length]!;
      const begin = Math.round(index * slot + random() * 200);
      const length = Math.round(slot * (0.7 + random() * 0.25));
      const tokens = text.split(/\s+/);
      const step = length / tokens.length;
      return {
        text,
        language: spoken.language,
        range: { start: { value: begin, rate: ms }, duration: { value: length, rate: ms } },
        words: tokens.map((word, w) => ({
          text: word,
          range: {
            start: { value: Math.round(begin + w * step), rate: ms },
            duration: { value: Math.max(1, Math.round(step * 0.9)), rate: ms },
          },
          confidence: 0.8 + random() * 0.2,
        })),
      };
    }),
  };
}

function stagesOf(asset: FakeAsset): AssetDetail['stages'] {
  return FAKE_STAGES.map((stage, i) => ({
    ...stageState(asset, stage, i),
    milestone: fakeMilestoneOf(stage),
  }));
}

function stageState(
  asset: FakeAsset,
  stage: FakeStage,
  i: number,
): Omit<AssetDetail['stages'][number], 'milestone'> {
  const { index } = asset.summary;
  if (i < index.done) return { stage, state: 'done' as const };
  if (index.state === 'failed' && i === index.done)
    return {
      stage,
      state: 'failed' as const,
      error: asset.extras.failure ?? {
        code: 'media.unreadable',
        messageKey: 'errors.media.unreadable',
        retryable: false,
      },
    };
  if (index.state === 'indexing' && i === index.done) return { stage, state: 'running' as const };
  if (stage.startsWith('audio.') && asset.extras.speech === null && index.state === 'done')
    return { stage, state: 'skipped' as const, reasonKey: 'indexing.skip.silent' };
  if (index.state === 'failed') return { stage, state: 'skipped' as const };
  // The library's reason while the original can't be read (its drive is away, or it's only in iCloud).
  return asset.summary.availability === 'online'
    ? { stage, state: 'waiting' as const }
    : { stage, state: 'waiting' as const, reasonKey: 'library.stage.originalOffline' };
}

export function fakeAssetDetail(asset: FakeAsset, source: FakeSource): AssetDetail {
  const { summary, extras } = asset;
  const shots = shotsOf(asset);
  const transcript = fakeTranscript(asset);
  const scene = SCENES[extras.scene]!;
  const random = prng(extras.n * 17 + 9);
  return {
    asset: summary,
    facts:
      summary.index.done >= 2 && summary.width && summary.height && summary.orientation
        ? {
            version: 1,
            width: summary.width,
            height: summary.height,
            orientation: summary.orientation,
            ...(summary.duration ? { duration: summary.duration, frameRate: extras.frameRate } : {}),
            variableFrameRate: false,
            hdr: random() < 0.3 ? 'hlg' : 'none',
            speed: 'normal',
            speedFactor: 1,
            retimedInFile: false,
            hasAudio: summary.kind === 'video',
            ...(summary.capturedAt ? { captureTime: new Date(summary.capturedAt).toISOString() } : {}),
            ...(scene.place && source.kind !== 'watched_folder'
              ? { location: { latitude: 15.49 + random() * 0.1, longitude: 73.82 + random() * 0.1 } }
              : {}),
            device: { make: 'Apple', model: 'iPhone 16 Pro' },
          }
        : null,
    shots: shots.map((shot) => ({
      ...shot,
      transcriptText:
        transcript?.segments
          .filter((segment) => overlaps(segment, shot))
          .map((segment) => segment.text)
          .join(' ') || null,
    })),
    transcript: transcript
      ? {
          language: transcript.language,
          lines: transcript.segments.map(({ text, range }) => ({ text, range })),
          truncated: false,
        }
      : null,
    locations: [
      {
        id: fakeUlid<'AssetLocation'>(KIND.location, extras.n),
        sourceId: source.id,
        sourceName: source.name,
        storage: source.kind === 'wifi_import' ? 'managed' : 'referenced',
        state:
          summary.availability === 'online'
            ? 'present'
            : summary.availability === 'missing'
              ? 'missing'
              : 'offline',
        relativePath: summary.name,
        volumeName: source.volume,
      },
    ],
    reencodeReasons: summary.reencode === 'likely' ? ['ios-browser', 'h264-aac', 'no-camera-metadata'] : [],
    stages: stagesOf(asset),
    playback: null,
    filmstrip: null,
    waveform: null,
    beats: null,
    sizeBytes: Math.round((4 + random() * 60) * 1_000_000),
  };
}

/** Speech (ms) overlapping a shot (its own frame rate). */
function overlaps(segment: TranscriptSegment, shot: ShotDetail): boolean {
  const toMs = (value: number, rate: { num: number; den: number }) => (value * rate.den * 1000) / rate.num;
  const shotStart = toMs(shot.range.start.value, shot.range.start.rate);
  const shotEnd = shotStart + toMs(shot.range.duration.value, shot.range.duration.rate);
  const start = segment.range.start.value;
  const end = start + segment.range.duration.value;
  return start < shotEnd && end > shotStart;
}
