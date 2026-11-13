// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Taalcut's breakdown of one of the site's reels, read by scripts/media.mjs from
 * ~/taalcut-site-footage/templates/<id>.json:
 *
 *   { beats: [s], cuts?: [s], seconds?: s, roll?: [{ file, start, end }] }
 *
 * - beats: the template's music beats, in seconds.
 * - cuts: its slot starts. Without them the scene detector's cuts stand, with how sure it was of each.
 * - seconds: how much of the reel the site plays, when a reel runs past the usual 14 s.
 * - roll: per shot, the raw clip it was cut from and the range the reel used. With it the camera roll shows the clip as
 *   it was shot, clean of any words the export burned in (WEB4: "Vietnam, on repeat" carries its POV line on every
 *   frame). A path is relative to the footage folder.
 */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const round = (n) => Math.round(n * 1000) / 1000;

export function templateTiming(footage, id) {
  const file = join(footage, 'templates', `${id}.json`);
  if (!existsSync(file)) return null;
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const beats = Array.isArray(json.beats) ? json.beats.filter((b) => typeof b === 'number') : null;
  const cuts = Array.isArray(json.cuts) ? json.cuts.filter((c) => typeof c === 'number') : null;
  if (!beats?.length) {
    console.warn(`templates/${id}.json has no { beats } in seconds: estimating instead`);
    return null;
  }
  const roll = Array.isArray(json.roll)
    ? json.roll.map((r) => ({ file: isAbsolute(r.file) ? r.file : join(footage, r.file), start: Number(r.start), end: Number(r.end) }))
    : null;
  const bad = roll?.find((r) => !existsSync(r.file) || !(r.end > r.start));
  if (bad) throw new Error(`templates/${id}.json: roll source ${bad.file} is missing or has an empty range`);
  return {
    beats: beats.map((b) => round(b)),
    cuts: cuts?.map((at) => ({ at: round(at), score: 100 })) ?? null,
    seconds: typeof json.seconds === 'number' && json.seconds > 0 ? json.seconds : null,
    roll,
  };
}
