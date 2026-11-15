// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The other picks a template's cast kept for a clip (EDT2), as the editor offers them over the clip: what the clip
 * plays now, then up to four other shots, best first. Pure, from the timeline's cast as the cast board reads it. A
 * clip without a cast slot (no template, the second half of a split, a dropped slot) has none, and neither has a
 * slot whose cast kept nothing else. Whether a shot still fits after an edit is the swap command's call, as on the
 * cast board; only what is certain from the file's own length is said beforehand.
 */
import {
  RationalTime,
  type AssetDetail,
  type CastCandidate,
  type FrameRate,
  type TimelineItemId,
} from '@taalcut/core';
import { shotKey } from '@taalcut/ui';
import { mediaOf, type ClipView, type TimelineModel } from '../model';

/** The most other shots the panel shows (the cast keeps three; a swap can bring a fourth). */
export const MAX_OTHER_SHOTS = 4;

export interface ShotOption {
  readonly key: string;
  readonly candidate: CastCandidate;
  /** What the clip plays now. */
  readonly current: boolean;
}

const UNSCORED: CastCandidate['parts'] = {
  intent: 0,
  motion: 0,
  quality: 0,
  subject: 0,
  energy: 0,
  hook: null,
  rerank: null,
  penalty: 0,
};

/** What the clip plays now, then the cast's other shots for its slot, best first; null with nothing else to offer. */
export function shotOptions(clip: ClipView): readonly ShotOption[] | null {
  const cast = clip.cast;
  if (!cast) return null;
  const media = mediaOf(clip.item);
  const now = shotKey(media);
  const seen = new Set([now]);
  const others: CastCandidate[] = [];
  for (const candidate of [...(cast.pick ? [cast.pick] : []), ...cast.alternates]) {
    const key = shotKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    others.push(candidate);
  }
  if (others.length === 0) return null;
  // The cast stores them best first; a pick swapped out since joins them at its own score.
  others.sort((a, b) => b.score - a.score);
  const playing: CastCandidate =
    cast.pick && shotKey(cast.pick) === now
      ? cast.pick
      : {
          ...media,
          sourceStart: clip.item.sourceStart,
          syncPoint: clip.item.syncPoint,
          score: 0,
          parts: UNSCORED,
        };
  return [
    { key: now, candidate: playing, current: true },
    ...others.slice(0, MAX_OTHER_SHOTS).map((candidate) => ({
      key: shotKey(candidate),
      candidate,
      current: false,
    })),
  ];
}

/** The clip's options, if it is still on the timeline and has any. */
export function optionsFor(model: TimelineModel, clipId: TimelineItemId): readonly ShotOption[] | null {
  const clip = model.clips.find((view) => view.item.id === clipId);
  return clip ? shotOptions(clip) : null;
}

/**
 * `options` in the order the panel first showed them (ones it hasn't shown go last): after a swap the mark moves
 * and the frames stay where they were, so the next press lands on the shot the person is looking at.
 */
export function inShownOrder(
  options: readonly ShotOption[],
  shown: readonly string[],
): readonly ShotOption[] {
  const place = (key: string) => {
    const at = shown.indexOf(key);
    return at < 0 ? shown.length : at;
  };
  return [...options].sort((a, b) => place(a.key) - place(b.key));
}

/** Where the option starts in its file, in ms. */
export function startMs(candidate: CastCandidate): number {
  return RationalTime.toSeconds(candidate.sourceStart) * 1000;
}

/** How much of its shot the option has from its start, in ms; null for a photo or before its file has loaded. */
export function footageMs(candidate: CastCandidate, detail: AssetDetail | null | undefined): number | null {
  if (!detail || candidate.shotId === null) return null;
  const shot = detail.shots.find((entry) => entry.id === candidate.shotId);
  const end = shot
    ? RationalTime.toSeconds(shot.range.start) + RationalTime.toSeconds(shot.range.duration)
    : detail.asset.duration
      ? RationalTime.toSeconds(detail.asset.duration)
      : null;
  if (end === null) return null;
  return Math.max(0, Math.round(end * 1000 - startMs(candidate)));
}

/**
 * True only when it is certain the swap would be refused as too short: a clip at real speed, and a file that ends
 * before the clip would. (A ramp can be made gentler and a shot's usable range is the timeline's to know, so
 * anything less certain is left to the command.)
 */
export function certainlyTooShort(
  clip: ClipView,
  rate: FrameRate,
  candidate: CastCandidate,
  detail: AssetDetail | null | undefined,
): boolean {
  if (!detail || candidate.shotId === null || clip.item.speed || clip.item.holdFrame) return false;
  if (!detail.asset.duration) return false;
  const frameMs = (1000 * rate.den) / rate.num;
  const room = RationalTime.toSeconds(detail.asset.duration) * 1000 - startMs(candidate);
  return room < (clip.end - clip.start) * frameMs - frameMs / 2;
}
