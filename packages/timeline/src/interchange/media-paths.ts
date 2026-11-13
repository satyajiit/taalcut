// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Originals as an interchange file names them (P3-V5, "media relinked by path"): the online path, else the last
 * known one (Final Cut relinks an offline asset by name), as a file URL or a bare POSIX path. Paths only ever go
 * into the written file.
 */
import type { AssetId, InterchangeMedia, InterchangePathStyle, MediaRef, Timeline } from '@taalcut/core';

/** The media of every clip on the video and audio tracks, in track order. */
export function clipMedia(timeline: Timeline): MediaRef[] {
  const out: MediaRef[] = [];
  for (const track of timeline.tracks) {
    if (track.kind === 'text') continue;
    for (const item of track.items) if (item.type === 'clip') out.push(item.media);
  }
  return out;
}

/** Every asset a timeline plays: clips on every track and the music bed. */
export function timelineAssets(timeline: Timeline): AssetId[] {
  const ids = new Set<AssetId>(clipMedia(timeline).map((media) => media.assetId));
  if (timeline.music.path === 'ownTrack' || timeline.music.path === 'generated')
    ids.add(timeline.music.assetId);
  return [...ids];
}

/** `file:///…` with each path segment percent-encoded (spaces, `#`, `?`, non-ASCII), slashes kept. */
export function fileUrl(path: string): string {
  const absolute = path.startsWith('/') ? path : `/${path}`;
  return `file://${absolute.split('/').map(encodeURIComponent).join('/')}`;
}

export interface WrittenMedia {
  /** What the file links: null when there is no path at all (never imported, or the library forgot it). */
  readonly target: string | null;
  /** True when the original isn't where the path says: the NLE shows it offline until relinked. */
  readonly offline: boolean;
  readonly name: string;
}

/** How one asset is written. An asset the library doesn't know is offline with its id as its name. */
export function writtenMedia(
  assetId: AssetId,
  media: ReadonlyMap<AssetId, InterchangeMedia>,
  style: InterchangePathStyle,
): WrittenMedia {
  const found = media.get(assetId);
  const path = found?.path ?? found?.lastKnownPath ?? null;
  const target = path === null ? null : style === 'fileUrl' ? fileUrl(path) : path;
  return { target, offline: !found?.path, name: found?.name ?? assetId };
}
