// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Media facts, derived files, shot analysis and transcripts (P2-L4, P2-L8): round-trips and bounds. */
import { describe, expect, it } from 'vitest';
import {
  derivedFileRefSchema,
  FrameRate,
  FrameRates,
  mediaFactsSchema,
  onScreenTextSchema,
  qualityScoresSchema,
  shotAnalysisSchema,
  thumbnailRefSchema,
  transcriptSchema,
  waveformRefSchema,
  type DerivedFileRef,
  type MediaFacts,
  type ShotAnalysis,
  type Transcript,
} from '@taalcut/core';
import { at, json, span } from './helpers/documents';

const HASH = 'b'.repeat(64);
const ms = FrameRate.of(1000);

const facts: MediaFacts = {
  version: 1,
  width: 1080,
  height: 1920,
  orientation: 'portrait',
  duration: at(300, FrameRates.fps29_97),
  frameRate: FrameRates.fps29_97,
  captureRate: FrameRate.of(240),
  variableFrameRate: true,
  hdr: 'hlg',
  speed: 'slow-motion',
  speedFactor: 8,
  retimedInFile: false,
  hasAudio: true,
  captureTime: '2026-10-01T10:00:00+05:30',
  location: { latitude: 15.5, longitude: 73.8 },
  device: { make: 'Apple', model: 'iPhone 17 Pro' },
  livePhoto: { contentId: 'ABC', role: 'movie', pairedBy: 'content-id' },
};

const thumbnail: DerivedFileRef = {
  kind: 'thumbnail',
  key: `thumbnails/bb/${HASH}.320.v1.jpg`,
  bytes: 12_000,
  mimeType: 'image/jpeg',
  width: 180,
  height: 320,
  recipe: 1,
};

const analysis: ShotAnalysis = {
  version: 1,
  range: span(0, 90, FrameRates.fps30),
  bestFrame: 12,
  orientation: 'portrait',
  quality: { version: 1, sharpness: 0.8, exposure: 0.7, stability: 0.9, overall: 0.8, flags: ['shaky'] },
  motion: 'pan',
  energy: 0.6,
  onScreenText: [
    {
      text: 'Goa',
      box: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 },
      range: span(0, 30, FrameRates.fps30),
      confidence: 0.9,
      script: 'latin',
      language: 'en',
      reveal: 'wordByWord',
    },
  ],
  dHash: '0123456789abcdef',
  description: {
    text: 'A beach at sunset',
    objects: ['sea', 'sun'],
    place: 'beach',
    shotType: 'wide',
    people: 2,
    model: { provider: 'local', model: 'qwen3-vl', local: true },
  },
};

const transcript: Transcript = {
  version: 1,
  language: 'hi',
  engine: 'parakeet',
  model: 'parakeet-tdt-0.6b-v3-coreml-int8',
  local: true,
  wordTiming: 'refined',
  segments: [
    {
      text: 'namaste Goa',
      range: span(0, 900, ms),
      language: 'hi',
      speaker: 'speaker_0',
      words: [
        { text: 'namaste', range: span(0, 400, ms), confidence: 0.9 },
        { text: 'Goa', range: span(450, 450, ms) },
      ],
    },
  ],
};

describe('analysis types', () => {
  it('media facts round-trip; a still has no duration or rate', () => {
    expect(mediaFactsSchema.parse(json(facts))).toEqual(facts);
    const still = { ...facts, duration: undefined, frameRate: undefined, captureRate: undefined };
    expect(mediaFactsSchema.safeParse(json(still)).success).toBe(true);
    expect(mediaFactsSchema.safeParse({ ...facts, location: { latitude: 91, longitude: 0 } }).success).toBe(
      false,
    );
    expect(mediaFactsSchema.safeParse({ ...facts, hdr: 'hdr10+' }).success).toBe(false);
  });

  it('derived files are named by key, never by path', () => {
    expect(derivedFileRefSchema.parse(json(thumbnail))).toEqual(thumbnail);
    for (const key of ['/Users/me/x.jpg', `thumbnails/bb/${HASH}.jpg`, `../thumbnails/bb/${HASH}.v1.jpg`]) {
      expect(derivedFileRefSchema.safeParse({ ...thumbnail, key }).success).toBe(false);
    }
    expect(thumbnailRefSchema.safeParse(thumbnail).success).toBe(true);
    const peaks = {
      ...thumbnail,
      kind: 'waveform',
      key: `waveforms/bb/${HASH}.v2.json`,
      mimeType: 'application/json',
    };
    expect(thumbnailRefSchema.safeParse(peaks).success).toBe(false);
    expect(waveformRefSchema.safeParse(peaks).success).toBe(true);
    expect(waveformRefSchema.safeParse(thumbnail).success).toBe(false);
  });

  it('a shot analysis round-trips; OCR sees only the reveals it can track', () => {
    expect(shotAnalysisSchema.parse(json(analysis))).toEqual(analysis);
    const skipped = { ...analysis, description: undefined, descriptionSkipped: 'no_consent' };
    expect(shotAnalysisSchema.safeParse(json(skipped)).success).toBe(true);
    expect(shotAnalysisSchema.safeParse({ ...analysis, dHash: 'xyz' }).success).toBe(false);
    expect(onScreenTextSchema.safeParse({ ...analysis.onScreenText[0], reveal: 'fade' }).success).toBe(false);
    expect(qualityScoresSchema.safeParse({ ...analysis.quality, overall: 1.2 }).success).toBe(false);
  });

  it('a transcript round-trips with word timings', () => {
    expect(transcriptSchema.parse(json(transcript))).toEqual(transcript);
    expect(transcriptSchema.safeParse({ ...transcript, engine: 'siri' }).success).toBe(false);
    expect(transcriptSchema.safeParse({ ...transcript, language: 'Hindi' }).success).toBe(false);
  });
});
