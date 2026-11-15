// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM2: the describer states, for each run of a shot's frames, whether the camera is filming or only being handled
 * (`"camera": "filming"` or `"handling"`), and the stated word is stored on the moment. Read from answers in the
 * on-device models' shapes: only the field is read, never a note's words; a handling stretch reaches to the nearest
 * frames seen held; an answer without the field reads as it did before MOM2. And the ask: the many-frame prompt asks
 * for it, the one-frame prompt is as it was. MOM3: the statement stands only at a shot's start and end, never on all
 * of a shot; the ask with the statement leaves out the camera's move.
 */
import { shotMomentsSchema } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  parseDescription,
  SHOT_DESCRIPTION_PROMPT,
  SHOT_MOMENTS_PROMPT,
  SHOT_MOMENTS_PROMPT_HANDLING,
  SHOT_MOMENTS_PROMPT_PLAIN,
} from '../../src/describe/describe-answer';
import {
  CAMERA_HANDLED,
  MOMENTS_FIELD,
  MOMENTS_FIELD_HANDLING,
  MOMENTS_FIELD_PLAIN,
  shotMoments,
} from '../../src/describe/moments';

/** A 4.8 s shot at 60 fps, seen at seven frames: each stands for 41.1 frames, and is the middle of them. */
const span = { length: 288, fps: 60, frames: 7 };
// The reader as it is when the ask has the model state each run's camera (`statesHandling`).
const runsOf = (moments: unknown) => shotMoments(moments, span, { handling: true });

/** As the on-device models answer the ask for that shot: the take ends with the camera covered, then lowered. */
const LOWERED = `\`\`\`json
{
  "description": "People hold up tickets in a hall, then an arm covers the lens and the camera drops to the floor.",
  "moments": [
    {"fromFrame": 1, "toFrame": 4, "note": "Hands hold up tickets and passports in a tiled hall.", "camera": "filming"},
    {"fromFrame": 5, "toFrame": 5, "note": "An arm covers the lens.", "camera": "handling"},
    {"fromFrame": 6, "toFrame": 7, "note": "The camera points down at the floor.", "camera": "handling"}
  ],
  "objects": ["tickets", "passports"], "actions": ["holding"], "place": "airport", "shotType": "pov", "people": 4
}
\`\`\``;

describe('a run stated as the camera being handled', () => {
  it('is stored on its moment, and reaches back to the last frame seen held', () => {
    const parsed = parseDescription(LOWERED);
    const moments = parsed?.success ? runsOf(parsed.data.moments) : null;
    // Frame 4 is the middle of its part, at frame 144 of the shot: what follows it was not seen held.
    expect(moments).toEqual([
      { start: 0, end: 144, note: 'Hands hold up tickets and passports in a tiled hall.' },
      { start: 144, end: 206, note: 'An arm covers the lens.', handling: true },
      { start: 206, end: 288, note: 'The camera points down at the floor.', handling: true },
    ]);
    expect(shotMomentsSchema.safeParse(moments).success).toBe(true);
  });

  it('reaches forward to the first frame seen held when a take starts with it', () => {
    expect(
      runsOf([
        { fromFrame: 1, toFrame: 2, note: 'The camera swings up from a bag.', camera: 'handling' },
        { fromFrame: 3, toFrame: 7, note: 'A boat crosses the bay.', camera: 'filming' },
      ]),
    ).toEqual([
      { start: 0, end: 103, note: 'The camera swings up from a bag.', handling: true },
      { start: 103, end: 288, note: 'A boat crosses the bay.' },
    ]);
  });

  it('is read from the stated field only, never from what a note says', () => {
    // The notes speak of a lowered camera and a covered lens; the model stated both runs as filming.
    expect(
      runsOf([
        {
          fromFrame: 1,
          toFrame: 4,
          note: 'The camera is lowered to the floor and shoes.',
          camera: 'filming',
        },
        { fromFrame: 5, toFrame: 7, note: 'A hand covers the lens.', camera: 'filming' },
      ]),
    ).toEqual([
      { start: 0, end: 165, note: 'The camera is lowered to the floor and shoes.' },
      { start: 165, end: 288, note: 'A hand covers the lens.' },
    ]);
    // And a plain note stated as handling is one.
    expect(
      runsOf([
        { fromFrame: 1, toFrame: 4, note: 'A boat crosses the bay.', camera: 'filming' },
        { fromFrame: 5, toFrame: 7, note: 'The boat reaches the pier.', camera: 'handling' },
      ]),
    ).toEqual([
      { start: 0, end: 144, note: 'A boat crosses the bay.' },
      { start: 144, end: 288, note: 'The boat reaches the pier.', handling: true },
    ]);
  });

  it('takes the asked word however it is cased, and a handling flag; another word is not one', () => {
    expect(CAMERA_HANDLED).toBe('handling');
    const flagged = (extra: Record<string, unknown>) =>
      runsOf([
        { fromFrame: 1, toFrame: 4, note: 'A' },
        { fromFrame: 5, toFrame: 7, note: 'B', ...extra },
      ])?.[1]?.handling;
    expect(flagged({ camera: ' Handling ' })).toBe(true);
    expect(flagged({ handling: true })).toBe(true);
    expect(flagged({ handling: 'true' })).toBe(true);
    for (const extra of [
      {},
      { camera: 'filming' },
      { camera: 'held' },
      { camera: 'handled' },
      { camera: true },
      { handling: false },
      { handling: 'no' },
      { camera: 'filming', handling: true },
    ])
      expect(flagged(extra)).toBeUndefined();
  });

  it('reads an answer without the field as before MOM2', () => {
    expect(
      runsOf([
        { fromFrame: 1, toFrame: 4, note: 'A' },
        { fromFrame: 5, toFrame: 7, note: 'B' },
      ]),
    ).toEqual([
      { start: 0, end: 165, note: 'A' },
      { start: 165, end: 288, note: 'B' },
    ]);
  });

  it('keeps two runs with the same note apart when only one is handling', () => {
    expect(
      runsOf([
        { fromFrame: 1, toFrame: 4, note: 'The floor of a hall.', camera: 'filming' },
        { fromFrame: 5, toFrame: 7, note: 'The floor of a hall.', camera: 'handling' },
      ]),
    ).toEqual([
      { start: 0, end: 144, note: 'The floor of a hall.' },
      { start: 144, end: 288, note: 'The floor of a hall.', handling: true },
    ]);
  });

  it('keeps a stretch stated in seconds where it was stated', () => {
    expect(
      shotMoments(
        [
          { from: 0, to: 2.8, note: 'A', camera: 'filming' },
          { from: 3, to: 4.8, note: 'B', camera: 'handling' },
        ],
        { length: 288, fps: 60 },
        { handling: true },
      ),
    ).toEqual([
      // The gap between the two goes to the held side's end: the handling stretch starts where it was stated.
      { start: 0, end: 180, note: 'A' },
      { start: 180, end: 288, note: 'B', handling: true },
    ]);
  });
});

/**
 * MOM3: a handling stretch is a take starting or stopping, so the statement stands only on the run or runs at a shot's
 * very start and very end, and never on all of a shot. In the owner's app the on-device 9B stated whole handheld pans.
 */
describe('where a stated run can stand', () => {
  it('stands at the very start and the very end of a shot, each reaching to the frames seen filmed', () => {
    expect(
      runsOf([
        { fromFrame: 1, toFrame: 2, note: 'A', camera: 'handling' },
        { fromFrame: 3, toFrame: 5, note: 'B', camera: 'filming' },
        { fromFrame: 6, toFrame: 7, note: 'C', camera: 'handling' },
      ]),
    ).toEqual([
      { start: 0, end: 103, note: 'A', handling: true },
      { start: 103, end: 185, note: 'B' },
      { start: 185, end: 288, note: 'C', handling: true },
    ]);
  });

  it('reads a run stated in the middle of a shot as filming', () => {
    // The third frame is stated between two filmed runs: a take does not stop and start again inside one shot.
    expect(
      runsOf([
        { fromFrame: 1, toFrame: 2, note: 'A', camera: 'filming' },
        { fromFrame: 3, toFrame: 3, note: 'B', camera: 'handling' },
        { fromFrame: 4, toFrame: 5, note: 'C', camera: 'filming' },
        { fromFrame: 6, toFrame: 7, note: 'D', camera: 'handling' },
      ]),
    ).toEqual([
      { start: 0, end: 82, note: 'A' },
      { start: 82, end: 123, note: 'B' },
      { start: 123, end: 185, note: 'C' },
      { start: 185, end: 288, note: 'D', handling: true },
    ]);
  });

  it('reads a shot whose every run is stated as stating none', () => {
    // As the 9B answered for a handheld pan across a room: one run, or two, all of them "handling".
    expect(
      runsOf([{ fromFrame: 1, toFrame: 7, note: 'A handheld pan across a room.', camera: 'handling' }]),
    ).toEqual([{ start: 0, end: 288, note: 'A handheld pan across a room.' }]);
    expect(
      runsOf([
        { fromFrame: 1, toFrame: 4, note: 'A handheld pan across a deck.', camera: 'handling' },
        { fromFrame: 5, toFrame: 7, note: 'The pan goes on to the water.', camera: 'handling' },
      ]),
    ).toEqual([
      { start: 0, end: 165, note: 'A handheld pan across a deck.' },
      { start: 165, end: 288, note: 'The pan goes on to the water.' },
    ]);
  });

  it('states none when only a blip of filming stands between a shot and handling all through', () => {
    // The first frame alone is filmed, 0.2 s of a 1.4 s shot: too short to stand, so it joins what follows it.
    const short = { length: 84, fps: 60, frames: 7 };
    expect(
      shotMoments(
        [
          { fromFrame: 1, toFrame: 1, note: 'A', camera: 'filming' },
          { fromFrame: 2, toFrame: 7, note: 'B', camera: 'handling' },
        ],
        short,
        { handling: true },
      ),
    ).toEqual([{ start: 0, end: 84, note: 'B' }]);
  });

  it('holds for runs stated in seconds too', () => {
    const read = (runs: unknown) => shotMoments(runs, { length: 288, fps: 60 }, { handling: true });
    expect(read([{ from: 0, to: 4.8, note: 'A', camera: 'handling' }])).toEqual([
      { start: 0, end: 288, note: 'A' },
    ]);
    expect(
      read([
        { from: 0, to: 1, note: 'A', camera: 'filming' },
        { from: 1, to: 2, note: 'B', camera: 'handling' },
        { from: 2, to: 4.8, note: 'C', camera: 'filming' },
      ])?.some((moment) => moment.handling),
    ).toBe(false);
  });
});

describe('the ask for a shot’s moments', () => {
  it('has a wording that asks each run for its camera, filming or handling, judged from the frames in order', () => {
    const asked = MOMENTS_FIELD_HANDLING;
    expect(asked).toContain('"camera": "filming" or "handling"}]');
    expect(asked).toContain('"camera" is "filming" for a run the person filming aimed the camera at');
    // A view the shot keeps to and a move that goes on showing the scene are filming, however low or unsteady.
    expect(asked).toContain('and for a shot that is one run: a view the shot keeps to, and a pan,');
    expect(asked).toContain('however low the camera points and however much it moves');
    expect(asked).toContain(
      '"camera" is "handling" only where, going by the frames in order, the take is stopping or starting',
    );
    // The one-frame ask has no runs to state it for: it is as it was.
    expect(SHOT_DESCRIPTION_PROMPT).not.toContain('handling');
  });

  it('does not ask for the camera’s move in the ask that has each run state its camera (MOM3)', () => {
    // "handheld" among the moves beside "handling" for a run: with both, the on-device 9B stated whole handheld pans.
    const move = '"cameraMotion": one of static, pan, tilt, push-in, pull-out, handheld, tracking or omit it';
    expect(SHOT_MOMENTS_PROMPT_HANDLING).toContain(MOMENTS_FIELD_HANDLING);
    expect(SHOT_MOMENTS_PROMPT_HANDLING).not.toContain('cameraMotion');
    expect(SHOT_MOMENTS_PROMPT_HANDLING).not.toContain('handheld');
    // It is otherwise the ask without the statement, which keeps the move, as the one-frame ask does.
    expect(SHOT_MOMENTS_PROMPT_PLAIN).toContain(move);
    expect(SHOT_DESCRIPTION_PROMPT).toContain(move);
    expect(SHOT_MOMENTS_PROMPT_HANDLING).toBe(
      SHOT_MOMENTS_PROMPT_PLAIN.replace(MOMENTS_FIELD_PLAIN, MOMENTS_FIELD_HANDLING).replace(`, ${move}`, ''),
    );
  });

  it('is the ask in use, and the reader reads the statement', () => {
    // On again since MOM3 (config `describe.moments.statesHandling`): the reader's structure, the ask without the move.
    expect(MOMENTS_FIELD).toBe(MOMENTS_FIELD_HANDLING);
    expect(SHOT_MOMENTS_PROMPT).toBe(SHOT_MOMENTS_PROMPT_HANDLING);
    expect(SHOT_MOMENTS_PROMPT).not.toBe(SHOT_MOMENTS_PROMPT_PLAIN);
    expect(
      shotMoments(
        [
          { fromFrame: 1, toFrame: 4, note: 'A', camera: 'filming' },
          { fromFrame: 5, toFrame: 8, note: 'B', camera: 'handling' },
        ],
        { ...span, frames: 8 },
      )?.map((moment) => moment.handling),
    ).toEqual([undefined, true]);
  });
});
