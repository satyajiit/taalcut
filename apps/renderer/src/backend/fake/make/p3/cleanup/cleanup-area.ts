// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The cleanup area's scenario (FakeMakeOptions.areas.cleanup). */
export interface CleanupAreaOptions {
  /** The talking-head project joins the seed (P3-V9). */
  readonly talkingHead?: boolean;
}

/** `areas.cleanup` as the seed reads it: only a `talkingHead: true` turns anything on. */
export function cleanupArea(areas: Readonly<Record<string, unknown>> | undefined): CleanupAreaOptions {
  const area: unknown = areas?.cleanup;
  return area && typeof area === 'object' && 'talkingHead' in area && area.talkingHead === true
    ? { talkingHead: true }
    : {};
}
