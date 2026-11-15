// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: facts about the platforms, for whoever places a video's text. Each platform draws its own interface over a
 * vertical video (a top bar, a caption and buttons at the bottom, a rail of buttons on the right); this is the part
 * of a 1080×1920 frame each leaves clear. They are facts the tools report (`platformsOver`), never a limit: no code
 * moves or refuses a text for them.
 *
 * Provisional: the numbers are render's `presets/safe-zones.v1.json`, read off the platforms' ad guides and never
 * matched to screenshots of the apps (`checkedOn: null` there). `render/test/presets/made-safe-area.test.ts` holds
 * this copy to that file.
 */
import type { NormalisedBox } from '@taalcut/core';

export const PLATFORM_FRAME = { width: 1080, height: 1920 } as const;

/** The part of `PLATFORM_FRAME` each platform's own interface leaves clear, pixels. */
export const PLATFORM_CLEAR_AREAS = {
  shorts: { x: 48, y: 288, width: 840, height: 960 },
  reels: { x: 65, y: 269, width: 950, height: 979 },
  tiktok: { x: 120, y: 240, width: 660, height: 1020 },
} as const;
export type Platform = keyof typeof PLATFORM_CLEAR_AREAS;

const vertical = (canvas: { readonly width: number; readonly height: number }) =>
  Math.abs(canvas.width / canvas.height - PLATFORM_FRAME.width / PLATFORM_FRAME.height) < 0.01;

/** The clear areas as shares of the frame, for a 9:16 video; null for any other shape (they are not known). */
export function platformAreas(canvas: {
  readonly width: number;
  readonly height: number;
}): Record<Platform, NormalisedBox> | null {
  if (!vertical(canvas)) return null;
  // To a ten-thousandth of the frame, as a stored box is.
  const part = (value: number, of: number) => Math.round((value / of) * 10_000) / 10_000;
  const share = (area: (typeof PLATFORM_CLEAR_AREAS)[Platform]): NormalisedBox => ({
    x: part(area.x, PLATFORM_FRAME.width),
    y: part(area.y, PLATFORM_FRAME.height),
    width: part(area.width, PLATFORM_FRAME.width),
    height: part(area.height, PLATFORM_FRAME.height),
  });
  return {
    shorts: share(PLATFORM_CLEAR_AREAS.shorts),
    reels: share(PLATFORM_CLEAR_AREAS.reels),
    tiktok: share(PLATFORM_CLEAR_AREAS.tiktok),
  };
}

/** The platforms whose own interface would cover part of `box` on a 9:16 video; none known for another shape. */
export function platformsOver(
  box: NormalisedBox,
  canvas: { readonly width: number; readonly height: number },
): Platform[] {
  const areas = platformAreas(canvas);
  if (!areas) return [];
  const slack = 1e-9;
  return (Object.keys(areas) as Platform[]).filter((platform) => {
    const area = areas[platform];
    return (
      box.x < area.x - slack ||
      box.y < area.y - slack ||
      box.x + box.width > area.x + area.width + slack ||
      box.y + box.height > area.y + area.height + slack
    );
  });
}
