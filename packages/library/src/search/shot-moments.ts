// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM1: what each shot shows over time, as the library tools show it to a model: one line per shot
 * (`0-2.8s: …; 2.8-4.8s: …`, core's `momentsInWords`), times in seconds of the shot's file, the clock `sourceStart`
 * and `playsShotFrom` use, so a model can name the part of a shot it wants. The notes are vision's (model output
 * from the user's media): the tools mark the line untrusted. Read with one statement, never parsing a whole analysis.
 * MOM2: a stretch the describer stated as the camera being handled is marked so (core's `HANDLING_MARK`).
 */
import { momentsInWords, shotMomentsSchema, type ShotMoment } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';

/**
 * How much of a shot's moments a search hit shows: its first three, each note cut to 90 characters, and none for a
 * shot with one moment (it says what the hit's sentence says) unless that moment is stated as handling (MOM2: the
 * sentence doesn't say so). `library.getAsset` shows them whole.
 */
export const HIT_MOMENTS = { count: 3, chars: 90, atLeast: 2 } as const;

export interface StoredMoments {
  readonly moments: readonly ShotMoment[];
  /** Frames a second of the grid the moments are on, and the shot's start in its file, in seconds. */
  readonly fps: number;
  readonly offsetSeconds: number;
}

/** The stored moments of these shots, by shot id; shots without any are left out. */
export function storedMoments(db: LibraryDatabase, shotIds: readonly string[]): Map<string, StoredMoments> {
  const found = new Map<string, StoredMoments>();
  if (shotIds.length === 0) return found;
  const rows = db.driver
    .prepare(
      `SELECT id, json_extract(analysis, '$.description.moments') AS moments,
              start_value, start_rate_num, start_rate_den, duration_value, duration_rate_num, duration_rate_den
       FROM shots WHERE id IN (SELECT value FROM json_each(?)) AND json_valid(analysis)
         AND json_type(analysis, '$.description.moments') = 'array'`,
    )
    .all(JSON.stringify([...new Set(shotIds)]));
  for (const row of rows) {
    let list: unknown;
    try {
      list = JSON.parse(String(row.moments));
    } catch {
      continue;
    }
    const parsed = shotMomentsSchema.safeParse(list);
    const seconds =
      (Number(row.duration_value) * Number(row.duration_rate_den)) / Number(row.duration_rate_num);
    const total = parsed.success ? (parsed.data.at(-1)?.end ?? 0) : 0;
    if (!parsed.success || !(seconds > 0) || !(total > 0)) continue;
    found.set(String(row.id), {
      moments: parsed.data,
      // The moments end at the shot's last frame, whatever grid they were written on.
      fps: total / seconds,
      offsetSeconds: (Number(row.start_value) * Number(row.start_rate_den)) / Number(row.start_rate_num),
    });
  }
  return found;
}

/**
 * Each shot's moments in one line, by shot id. Shots without any are left out, and so are shots with fewer than
 * `atLeast` unless one of theirs is stated as handling.
 */
export function momentWords(
  db: LibraryDatabase,
  shotIds: readonly string[],
  limits: { readonly count?: number; readonly chars?: number; readonly atLeast?: number } = {},
): Map<string, string> {
  const { atLeast = 1, ...words } = limits;
  return new Map(
    [...storedMoments(db, shotIds)]
      .filter(
        ([, stored]) => stored.moments.length >= atLeast || stored.moments.some((moment) => moment.handling),
      )
      .map(([shotId, stored]) => [
        shotId,
        momentsInWords(stored.moments, { fps: stored.fps, offsetSeconds: stored.offsetSeconds, ...words }),
      ]),
  );
}
