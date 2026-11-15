// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM1: what a shot shows over time, as the timeline tools show it to a model (SPEC, "MOM1: the part of a shot"):
 * one line of moments with their times in seconds of the shot's file (core's `momentsInWords`), the clock
 * `playsShotFrom`, `sourceStart` and a stated part use. Read from the shots' profiles (the casting engine's), so no
 * tool needs its own reader. The notes are vision's words about the user's media: every line here goes into a string
 * the tools mark untrusted.
 *
 * Token cost is bounded here. A shot with one moment shows none: the moment says what the shot's sentence says (26
 * of the 28 shots in the owner's video were one moment). A rerank candidate shows its first three moments, each
 * note cut to 100 characters (the 4B's notes ran to 97 at the median), and one rerank list at most
 * `RERANK_MOMENT_CHARS` of them in all (about 500 tokens). A placed clip shows the two moments its part plays (100
 * characters each) and three of the rest (80 each): about 30 tokens a moment with its times.
 *
 * MOM2: a stretch the describer stated as the camera being handled is marked `(camera handling)` after its times
 * (core's `HANDLING_MARK`), and a shot with one moment shows it when that moment is one: its sentence doesn't say
 * that the whole shot is the camera being handled.
 */
import {
  momentsDuring,
  momentsInWords,
  RationalTime,
  type AsyncResult,
  type ShotProfile,
  type ShotProfileRef,
} from '@taalcut/core';

/** The shots' profiles: the casting engine's `profiles`. */
export type ShotProfiles = (
  refs: readonly ShotProfileRef[],
  signal?: AbortSignal,
) => AsyncResult<ShotProfile[]>;

export const MOMENT_WORDS = {
  rerank: { count: 3, chars: 100 },
  plays: { count: 2, chars: 100 },
  rest: { count: 3, chars: 80 },
} as const;

/** All the moments one rerank list shows, in characters: candidates past it show their sentence alone. */
export const RERANK_MOMENT_CHARS = 2_000;

type Limits = { readonly count: number; readonly chars: number };

const clockOf = (profile: ShotProfile) => {
  const rate = profile.range.start.rate;
  return { fps: rate.num / rate.den, offsetSeconds: RationalTime.toSeconds(profile.range.start) };
};

/** Whether a shot's moments say more than its sentence: two or more, or (MOM2) one stated as handling. */
const worthShowing = (moments: NonNullable<ShotProfile['moments']>) =>
  moments.length >= 2 || moments.some((moment) => moment.handling);

/** A shot's moments in one line, times in seconds of its file; null for a shot whose moments say no more. */
export function momentsLine(profile: ShotProfile, limits: Limits = MOMENT_WORDS.rerank): string | null {
  const moments = profile.moments ?? [];
  return worthShowing(moments) ? momentsInWords(moments, { ...clockOf(profile), ...limits }) : null;
}

/**
 * For a clip that plays `seconds` of the shot from `fromSeconds` of its file: the moments that part plays, and the
 * rest of the shot's. Both null for a shot whose moments say no more than its sentence; `rest` null when the part
 * plays them all.
 */
export function partLines(
  profile: ShotProfile,
  fromSeconds: number,
  seconds: number,
): { readonly plays: string | null; readonly rest: string | null } {
  const moments = profile.moments ?? [];
  if (!worthShowing(moments)) return { plays: null, rest: null };
  const clock = clockOf(profile);
  const from = (fromSeconds - clock.offsetSeconds) * clock.fps;
  // A part of no length still plays the moment it starts in.
  const used = momentsDuring(moments, from, from + Math.max(1, seconds * clock.fps));
  const rest = moments.filter((moment) => !used.includes(moment));
  const line = (list: typeof moments, limits: Limits) =>
    list.length === 0 ? null : momentsInWords(list, { ...clock, ...limits });
  return { plays: line(used, MOMENT_WORDS.plays), rest: line(rest, MOMENT_WORDS.rest) };
}

/** MOM2: the profiles of the shots the model stated parts for, whose handling stretches a part is read against. */
export const partProfiles = (
  profiles: ShotProfiles | undefined,
  parts: readonly { readonly shotId: string }[] | undefined,
  signal?: AbortSignal,
): Promise<Map<string, ShotProfile>> =>
  profilesByShot(
    profiles,
    (parts ?? []).map((part) => part.shotId),
    signal,
  );

/** The profiles of these shots by shot id; empty when there is no reader or it fails (a tool never fails for them). */
export async function profilesByShot(
  profiles: ShotProfiles | undefined,
  shotIds: readonly string[],
  signal?: AbortSignal,
): Promise<Map<string, ShotProfile>> {
  const ids = [...new Set(shotIds)];
  if (!profiles || ids.length === 0) return new Map();
  const read = await profiles(
    ids.map((shotId) => ({ assetId: '', shotId })),
    signal,
  ).catch(() => null);
  if (!read?.ok) return new Map();
  return new Map(
    read.value.flatMap((profile) => (profile.shotId ? [[profile.shotId as string, profile]] : [])),
  );
}
