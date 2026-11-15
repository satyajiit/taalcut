// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM1: a shot's moments read from describer answers in the on-device model's shapes (runs of numbered frames as it
 * is asked for; seconds, gapped, overlapping, out of order, times as text, other field names, junk) and normalised:
 * in order, inside the shot, consecutive from its first frame to its last, no blips, at most twelve. The model's
 * words are kept as written. And the ask: each picture after its own label.
 */
import { SHOT_MOMENT_LIMITS, shotMomentsSchema } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { VISION_CONFIG } from '../../src/config';
import {
  frameRequestText,
  parseDescription,
  SHOT_DESCRIPTION_PROMPT,
  SHOT_MOMENTS_PROMPT,
  SHOT_MOMENTS_PROMPT_PLAIN,
  shotContent,
} from '../../src/describe/describe-answer';
import { frameLabel, MOMENTS_FIELD_PLAIN, momentsRequestText, shotMoments } from '../../src/describe/moments';

/** A 4.8 s shot at 60 fps. */
const span = { length: 288, fps: 60 };
const momentsOf = (answer: string) => {
  const parsed = parseDescription(answer);
  return parsed?.success ? shotMoments(parsed.data.moments, span) : undefined;
};

/** As the 4B answers a five-frame ask: fenced, the ranges clean. */
const CLEAN = `\`\`\`json
{"description": "People hold up tickets in a hall, then the camera tilts down to the floor.",
 "moments": [
  {"from": 0, "to": 2.8, "note": "Hands hold up tickets and passports in a tiled hall."},
  {"from": 2.8, "to": 4.0, "note": "The camera tilts down, the picture blurred."},
  {"from": 4.0, "to": 4.8, "note": "The floor, with shoes and suitcases."}
 ],
 "objects": ["tickets", "passports", "suitcases"], "actions": ["holding"], "place": "airport", "shotType": "medium", "people": 4}
\`\`\``;

/** As the 4B answers a seven-frame ask of that shot: fenced, each moment a run of frame numbers. */
const RUNS = `\`\`\`json
{
  "description": "People hold up tickets in a hall, then an arm covers the lens and the camera tilts down.",
  "moments": [
    {"fromFrame": 1, "toFrame": 4, "note": "Hands hold up tickets and passports in a tiled hall."},
    {"fromFrame": 5, "toFrame": 5, "note": "An arm covers the lens."},
    {"fromFrame": 6, "toFrame": 7, "note": "The camera points down at the floor."}
  ],
  "objects": ["tickets", "passports"], "actions": ["holding"], "place": "airport", "shotType": "pov", "people": 4
}
\`\`\``;
const runsOf = (moments: unknown, frames = 7) => shotMoments(moments, { ...span, frames });

describe('shotMoments from runs of numbered frames', () => {
  it('gives each run the parts of the shot its frames stand for', () => {
    const parsed = parseDescription(RUNS);
    const moments = parsed?.success ? runsOf(parsed.data.moments) : null;
    // Seven frames, each the middle of a seventh of 288 frames: frames 1 to 4 are the first four sevenths.
    expect(moments).toEqual([
      { start: 0, end: 165, note: 'Hands hold up tickets and passports in a tiled hall.' },
      { start: 165, end: 206, note: 'An arm covers the lens.' },
      { start: 206, end: 288, note: 'The camera points down at the floor.' },
    ]);
    expect(shotMomentsSchema.safeParse(moments).success).toBe(true);
  });

  it('reads numbers written as text, fills a frame no run names, and stops at the last frame', () => {
    expect(
      runsOf([
        { fromFrame: '1', toFrame: '2', note: 'A' },
        // Frame 3 is in no run: its part is split between its neighbours. Frame 9 does not exist.
        { from_frame: 4, to_frame: 9, note: 'B' },
      ]),
    ).toEqual([
      { start: 0, end: 103, note: 'A' },
      { start: 103, end: 288, note: 'B' },
    ]);
    // Runs win over seconds given beside them; a run that ends before it starts is dropped.
    expect(
      runsOf([
        { fromFrame: 1, toFrame: 3, from: 0, to: 1, note: 'A' },
        { fromFrame: 4, toFrame: 7, from: 1, to: 2, note: 'B' },
        { fromFrame: 6, toFrame: 5, note: 'Backwards.' },
      ]),
    ).toEqual([
      { start: 0, end: 123, note: 'A' },
      { start: 123, end: 288, note: 'B' },
    ]);
  });

  it('reads runs counted from 0 as the same frames', () => {
    const fromOne = runsOf([
      { fromFrame: 1, toFrame: 4, note: 'A' },
      { fromFrame: 5, toFrame: 7, note: 'B' },
    ]);
    const fromZero = runsOf([
      { fromFrame: 0, toFrame: 3, note: 'A' },
      { fromFrame: 4, toFrame: 6, note: 'B' },
    ]);
    expect(fromZero).toEqual(fromOne);
    expect(fromOne).toEqual([
      { start: 0, end: 165, note: 'A' },
      { start: 165, end: 288, note: 'B' },
    ]);
  });

  it('has no use for frame numbers when it does not know how many frames were shown', () => {
    expect(shotMoments([{ fromFrame: 1, toFrame: 4, note: 'A' }], span)).toBeNull();
    // A fraction is not a frame number.
    expect(runsOf([{ fromFrame: 1.5, toFrame: 4, note: 'A' }])).toBeNull();
  });

  it('keeps a shot whose times the model got wrong as one moment, never a range outside it', () => {
    // Recorded before the ask named frames: the 4B put a change it saw at frame 8 of 10 at 5.8 s of a 4.8 s shot.
    expect(
      runsOf(
        [
          { from: 0, to: 5.8, note: 'People hold up tickets.' },
          { from: 5.8, to: 6.8, note: 'The camera tilts down to the floor.' },
        ],
        10,
      ),
    ).toEqual([{ start: 0, end: 288, note: 'People hold up tickets.' }]);
  });
});

describe('shotMoments from seconds', () => {
  it('keeps a clean answer as the model gave it, in frames of the shot', () => {
    expect(momentsOf(CLEAN)).toEqual([
      { start: 0, end: 168, note: 'Hands hold up tickets and passports in a tiled hall.' },
      { start: 168, end: 240, note: 'The camera tilts down, the picture blurred.' },
      { start: 240, end: 288, note: 'The floor, with shoes and suitcases.' },
    ]);
    expect(shotMomentsSchema.safeParse(momentsOf(CLEAN)).success).toBe(true);
  });

  it('splits a gap or an overlap at its middle, and reaches the shot’s first and last frame', () => {
    // The model named the frames' own times: a gap between 1.4 and 2.4, an overlap at 3.3 to 3.5, nothing after 4.3.
    const answer = JSON.stringify({
      description: 'x',
      objects: [],
      moments: [
        { from: 0.5, to: 1.4, note: 'A' },
        { from: 2.4, to: 3.5, note: 'B' },
        { from: 3.3, to: 4.3, note: 'C' },
      ],
    });
    expect(momentsOf(answer)).toEqual([
      { start: 0, end: 114, note: 'A' },
      { start: 114, end: 204, note: 'B' },
      { start: 204, end: 288, note: 'C' },
    ]);
  });

  it('puts ranges in order and reads times written as text and other field names', () => {
    const answer = JSON.stringify({
      description: 'x',
      objects: [],
      moments: [
        { start: '2.4s', end: '4.8 s', description: '  Second   stretch. ' },
        { start: '0', end: '2.4', shows: 'First stretch.' },
      ],
    });
    expect(momentsOf(answer)).toEqual([
      { start: 0, end: 144, note: 'First stretch.' },
      { start: 144, end: 288, note: 'Second stretch.' },
    ]);
  });

  it('keeps ranges inside the shot: one past its end is cut, one wholly outside dropped', () => {
    const answer = JSON.stringify({
      description: 'x',
      objects: [],
      moments: [
        { from: -1, to: 3, note: 'A' },
        { from: 3, to: 9, note: 'B' },
        { from: 9, to: 12, note: 'C' },
      ],
    });
    expect(momentsOf(answer)).toEqual([
      { start: 0, end: 180, note: 'A' },
      { start: 180, end: 288, note: 'B' },
    ]);
  });

  it('joins a stretch under half a second to its neighbour, and equal neighbours to each other', () => {
    const answer = JSON.stringify({
      description: 'x',
      objects: [],
      moments: [
        { from: 0, to: 1, note: 'A street.' },
        { from: 1, to: 2, note: 'A street.' },
        { from: 2, to: 2.2, note: 'A blip.' },
        { from: 2.2, to: 4.8, note: 'A market.' },
      ],
    });
    expect(momentsOf(answer)).toEqual([
      // The blip's 12 frames went to the stretch before it.
      { start: 0, end: 132, note: 'A street.' },
      { start: 132, end: 288, note: 'A market.' },
    ]);
  });

  it('keeps at most twelve, the shortest joining their neighbours, and cuts a long note', () => {
    const long = { length: 60 * 30, fps: 60 };
    const many = Array.from({ length: 15 }, (_, n) => ({ from: n * 2, to: n * 2 + 2, note: `Part ${n}.` }));
    const kept = shotMoments(many, long)!;
    expect(kept).toHaveLength(SHOT_MOMENT_LIMITS.count);
    expect(kept[0]!.start).toBe(0);
    expect(kept.at(-1)!.end).toBe(long.length);
    expect(shotMomentsSchema.safeParse(kept).success).toBe(true);
    const wordy = shotMoments([{ from: 0, to: 4.8, note: 'w'.repeat(400) }], span)!;
    expect(wordy[0]!.note).toHaveLength(SHOT_MOMENT_LIMITS.chars);
  });

  it('says the same thing throughout as one moment over the whole shot', () => {
    expect(shotMoments([{ from: 0, to: 4.8, note: 'A boat crosses the bay.' }], span)).toEqual([
      { start: 0, end: 288, note: 'A boat crosses the bay.' },
    ]);
  });

  it('gives null for an answer it cannot use, so the shot keeps its sentence', () => {
    for (const bad of [
      undefined,
      null,
      'from 0 to 2 a street',
      {},
      [],
      [{ from: 0, to: 2 }],
      [{ note: 'No times.' }],
      [{ from: 3, to: 1, note: 'Backwards.' }],
      [{ from: 'soon', to: 'later', note: 'Not numbers.' }],
      [{ from: 20, to: 30, note: 'Outside the shot.' }],
    ])
      expect(shotMoments(bad, span)).toBeNull();
    expect(shotMoments([{ from: 0, to: 1, note: 'A' }], { length: 0, fps: 60 })).toBeNull();
    // An answer without the field parses as before: no moments, the sentence kept.
    expect(momentsOf('{"description": "A street.", "objects": []}')).toBeNull();
  });
});

describe('the moments ask', () => {
  const times = { at: [0.48, 1.44, 2.4, 3.36, 4.32], seconds: 4.8 };
  const pictures = (count: number) =>
    Array.from({ length: count }, (_, n) => ({ type: 'image' as const, data: `picture-${n + 1}` }));

  it('says how many numbered frames there are and how long the shot is', () => {
    const text = momentsRequestText(times);
    expect(text).toBe(
      'These 5 numbered frames are in chronological order from one continuous shot 4.8 s long; each picture ' +
        'comes after its number and time. Describe the full shot and its moments as JSON.',
    );
    expect(frameRequestText(undefined, undefined, 5, times)).toBe(text);
    // Without times the ask is the one from before MOM1.
    expect(frameRequestText(undefined, undefined, 3)).toContain('Describe the full shot across all frames');
  });

  it('puts each picture after its own label, the first label with the ask', () => {
    expect(frameLabel(2, 2.4)).toBe('Frame 3, at 2.4 s:');
    const parts = shotContent('The ask.', pictures(5), times);
    expect(parts.map((part) => (part.type === 'text' ? part.text : part.data))).toEqual([
      'The ask.\n\nFrame 1, at 0.5 s:',
      'picture-1',
      'Frame 2, at 1.4 s:',
      'picture-2',
      'Frame 3, at 2.4 s:',
      'picture-3',
      'Frame 4, at 3.4 s:',
      'picture-4',
      'Frame 5, at 4.3 s:',
      'picture-5',
    ]);
    // Eight labelled pictures are the sixteen parts one ask may have; every tier's cap fits.
    const eight = { at: Array.from({ length: 8 }, (_, n) => n), seconds: 8 };
    expect(shotContent('The ask.', pictures(8), eight)).toHaveLength(16);
    for (const { maxFrames } of Object.values(VISION_CONFIG.describe.moments.frames))
      expect(maxFrames).toBeLessThanOrEqual(8);
    // Without times (one frame, or a shot asked as before MOM1): the ask, then the pictures.
    expect(shotContent('The ask.', pictures(2), undefined).map((part) => part.type)).toEqual([
      'text',
      'image',
      'image',
    ]);
  });

  it('asks for moments in the model’s own words, with no list of what a stretch may show', () => {
    expect(SHOT_MOMENTS_PROMPT).toContain('"moments"');
    expect(SHOT_MOMENTS_PROMPT).toContain('"fromFrame"');
    expect(SHOT_MOMENTS_PROMPT).toContain('"toFrame"');
    expect(SHOT_MOMENTS_PROMPT).toContain('what is visible in its own frames only');
    expect(SHOT_MOMENTS_PROMPT).toContain('also when the camera shows nothing in particular');
    // The one-frame prompt is the one from before MOM1, word for word but for the field (the ask that also has
    // each run state its camera differs by more: handling.test.ts).
    expect(SHOT_DESCRIPTION_PROMPT).not.toContain('"moments"');
    expect(SHOT_MOMENTS_PROMPT_PLAIN.replace(` ${MOMENTS_FIELD_PLAIN}`, '')).toBe(SHOT_DESCRIPTION_PROMPT);
    expect(SHOT_DESCRIPTION_PROMPT).toContain('(always give it), "objects": up to 12 short nouns');
  });
});
