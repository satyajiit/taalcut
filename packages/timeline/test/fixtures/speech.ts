// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Generated talking-head fixtures for P3-V9: a speech analysis (words on Parakeet's 80 ms grid with jitter,
 * fillers, long and short pauses, one retake, emphasis) and a timeline whose one clip plays it, at any media
 * and canvas rate. Deterministic for a seed. The labelled clips (H3) replace these for the eval.
 */
import {
  DEFAULT_MIX,
  FrameRate,
  newId,
  RationalTime,
  TimeRange,
  TIMELINE_SCHEMA_VERSION,
  timelineSchema,
  type AssetId,
  type SpeechCleanupAnalysis,
  type Timeline,
} from '@taalcut/core';
import { random } from './library';

const MS = FrameRate.of(1000);
const range = (startMs: number, endMs: number) =>
  TimeRange.of(RationalTime.of(startMs, MS), RationalTime.of(endMs - startMs, MS));

export interface SpeechDef {
  readonly seed: number;
  readonly words?: number;
  readonly fillerEvery?: number;
  readonly pauseEvery?: number;
  readonly retake?: boolean;
}

export interface TalkingHead {
  readonly analysis: SpeechCleanupAnalysis;
  /** Where the speech ends, in ms. */
  readonly endMs: number;
  /** Indices of words that are fillers. */
  readonly fillerWords: ReadonlySet<number>;
  /** Indices of the earlier take's words. */
  readonly retakeWords: ReadonlySet<number>;
  /** Pauses longer than 500 ms, [start, end] in ms. */
  readonly longPauses: readonly (readonly [number, number])[];
}

const grid = (ms: number) => Math.round(ms / 80) * 80;
const ms = (time: RationalTime) => RationalTime.toSeconds(time) * 1000;

type Words = SpeechCleanupAnalysis['words'];

/** Says words one after another on the 80 ms grid, with a jittered gap after each. */
function speaker(next: () => number) {
  const words: Words = [];
  let at = 480;
  return {
    words,
    get at() {
      return at;
    },
    say(text: string, length: number): number {
      const start = grid(at);
      const end = grid(at + length);
      words.push({ text, range: range(start, end), confidence: 0.9 });
      at = end + 40 + Math.round(next() * 60);
      return words.length - 1;
    },
    wait(length: number) {
      at += length;
    },
  };
}
type Speaker = ReturnType<typeof speaker>;

/** "so the product … so the product is great": a false start, its words, and the take that repeats it. */
function sayRetake(voice: Speaker) {
  const earlier = [voice.say('so', 200), voice.say('the', 160), voice.say('product', 400)];
  voice.wait(320);
  const later = [
    voice.say('so', 200),
    voice.say('the', 160),
    voice.say('product', 400),
    voice.say('is', 160),
    voice.say('great', 400),
  ];
  const spanOf = (from: number, to: number) => {
    const first = voice.words[from]?.range as TimeRange;
    const last = voice.words[to]?.range as TimeRange;
    return TimeRange.fromStartEnd(first.start, TimeRange.end(last));
  };
  const retake = {
    earlier: spanOf(earlier[0] as number, earlier[2] as number),
    later: spanOf(later[0] as number, later[4] as number),
    similarity: 0.9,
    kind: 'falseStart' as const,
  };
  return { retake, words: new Set(earlier) };
}

/** The body: words with a filler and a long pause every so often, and emphasis on every seventh. */
function sayBody(voice: Speaker, def: SpeechDef, next: () => number) {
  const fillers: SpeechCleanupAnalysis['fillers'] = [];
  const emphasis: SpeechCleanupAnalysis['emphasis'] = [];
  const fillerWords = new Set<number>();
  for (let index = 0; index < (def.words ?? 40); index++) {
    if (def.fillerEvery && index % def.fillerEvery === def.fillerEvery - 1) {
      const filler = voice.say('um', 240 + Math.round(next() * 160));
      fillerWords.add(filler);
      fillers.push({
        range: voice.words[filler]?.range as TimeRange,
        text: 'um',
        wordIndex: filler,
        confidence: 0.9,
      });
    }
    const word = voice.say(`word${index}`, 160 + Math.round(next() * 320));
    if (index % 7 === 3)
      emphasis.push({ wordIndex: word, range: voice.words[word]?.range as TimeRange, strength: 0.85 });
    if (def.pauseEvery && index % def.pauseEvery === def.pauseEvery - 1)
      voice.wait(600 + Math.round(next() * 900));
  }
  return { fillers, emphasis, fillerWords };
}

/** Speech segments: runs of words separated by 200 ms or more; every such gap is a pause. */
function segmentsOf(words: Words) {
  const speech: SpeechCleanupAnalysis['speech'] = [];
  const pauses: SpeechCleanupAnalysis['pauses'] = [];
  let segmentStart = ms(words[0]?.range.start ?? RationalTime.zero(MS));
  words.forEach((word, index) => {
    const end = ms(TimeRange.end(word.range));
    const following = words[index + 1];
    const nextStart = following ? ms(following.range.start) : null;
    if (nextStart !== null && nextStart - end < 200) return;
    speech.push(range(segmentStart, end));
    if (nextStart === null) return;
    pauses.push({ range: range(end, nextStart) });
    segmentStart = nextStart;
  });
  return { speech, pauses };
}

export function talkingHead(assetId: AssetId, def: SpeechDef): TalkingHead {
  const next = random(def.seed);
  const voice = speaker(next);
  const retake = def.retake ? sayRetake(voice) : null;
  const body = sayBody(voice, def, next);
  const { speech, pauses } = segmentsOf(voice.words);
  const longPauses = pauses
    .map((pause) => [ms(pause.range.start), ms(TimeRange.end(pause.range))] as const)
    .filter(([start, end]) => end - start > 500);
  return {
    analysis: {
      version: 1,
      assetId,
      contentHash: `hash-${def.seed}`,
      configVersion: 1,
      language: 'en',
      engine: 'parakeet',
      words: voice.words,
      speech,
      fillers: body.fillers,
      pauses,
      retakes: retake ? [retake.retake] : [],
      emphasis: body.emphasis,
      ambiguous: [],
    },
    endMs: grid(voice.at) + 480,
    fillerWords: body.fillerWords,
    retakeWords: retake?.words ?? new Set<number>(),
    longPauses,
  };
}

/** The V1 clip playing the whole take from `offsetFrames` into the media, cut on the canvas rate. */
function talkingClip(head: TalkingHead, media: FrameRate, canvas: FrameRate, offsetFrames: number) {
  const sourceStart = RationalTime.of(offsetFrames, media);
  const startMs = RationalTime.toSeconds(sourceStart) * 1000;
  const frames = Math.floor(((head.endMs - startMs) / 1000) * FrameRate.toNumber(canvas));
  const mediaEnd = Math.ceil(((head.endMs + 2000) / 1000) * FrameRate.toNumber(media));
  return {
    type: 'clip',
    id: newId<'TimelineItem'>(),
    media: {
      kind: 'video',
      assetId: head.analysis.assetId,
      shotId: null,
      available: TimeRange.of(RationalTime.zero(media), RationalTime.of(mediaEnd, media)),
    },
    sourceStart,
    duration: RationalTime.of(frames, canvas),
    speed: null,
    slotId: newId<'TemplateSlot'>(),
    syncPoint: null,
    beatAnchor: null,
    fit: 'cover',
    audio: { gainDb: 0, muted: false },
    locked: false,
    enabled: true,
    stillMotion: null,
    reframe: null,
  };
}

/** One clip playing the whole take from `offsetFrames` into the media, on a canvas of `canvas`. */
export function talkingTimeline(
  head: TalkingHead,
  media: FrameRate,
  canvas: FrameRate,
  offsetFrames = 12,
): Timeline {
  const clip = talkingClip(head, media, canvas, offsetFrames);
  return timelineSchema.parse({
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    id: newId<'Timeline'>(),
    projectId: newId<'Project'>(),
    name: 'Talking head',
    revision: 1,
    canvas: { width: 1080, height: 1920, rate: canvas },
    template: null,
    beatMap: null,
    tracks: [
      { kind: 'video', id: 'V1', name: 'V1', enabled: true, items: [clip] },
      { kind: 'text', id: 'T1', name: 'T1', enabled: true, items: [] },
    ],
    markers: [],
    cast: null,
    captions: null,
    music: { path: 'platformSound' },
    styleId: null,
    voiceover: null,
    mix: DEFAULT_MIX,
    createdAt: 0,
    updatedAt: 0,
  });
}
