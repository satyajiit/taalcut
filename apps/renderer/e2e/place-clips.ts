// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fake library's clips with a place (LIB1-PLACE, backend/fake/library/fake-places.ts), by id:
 * fakeUlid(KIND.asset, n). test/fake-places.test.ts checks each against the fake.
 */
export const PLACE_CLIPS = {
  /** GX014801.MP4: Lisbon, from its own coordinates; in the Portugal trip. */
  lisbon: '01K7C5M6Q810000000000004P1',
  /** PXL_20260321_104799.mp4: on a boat 19 km past Cascais: "Near Cascais". */
  nearCascais: '01K7C5M6Q810000000000004NZ',
  /** DJI_0800.MP4: no coordinates of its own; Sintra, from a clip shot within three hours. */
  borrowed: '01K7C5M6Q810000000000004P0',
  /** PXL_20260514_104810.mp4: no coordinates and no clip with them nearby; only UTC+1 from a neighbour. */
  zone: '01K7C5M6Q810000000000004PA',
  /** DJI_0183.MP4: in the June trip known only by UTC−3. */
  hinted: '01K7C5M6Q8100000000000042Q',
} as const;
