// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fake's sample clips (UX2, backend/fake/library/sample-clips.ts): clips backed by real files in
 * e2e/sample-media, by id. fakeUlid(KIND.asset, n) for n 90,101 to 90,109; test/fake-sample-clips.test.ts checks
 * them against the fake.
 */
export const SAMPLE = {
  /** IMG_4471.MOV: 6.1 s, vertical, four shots, English speech, text on screen; fully analysed. */
  portrait: '01K7C5M6Q81000000000002QZN',
  /** DJI_0412.MP4: 8 s, horizontal, aerial, music with its beats. */
  landscape: '01K7C5M6Q81000000000002QZP',
  /** PXL_….mp4: filmed on its side, played upright. */
  rotated: '01K7C5M6Q81000000000002QZQ',
  /** IMG_4502.MOV: no sound. */
  silent: '01K7C5M6Q81000000000002QZR',
  /** IMG_4520.MOV: the PO's case, eight steps done and seven waiting for on-device models. */
  waitingForModels: '01K7C5M6Q81000000000002QZS',
  /** IMG_4533.MOV: its copy to play is still being made. */
  preparing: '01K7C5M6Q81000000000002QZT',
  /** WhatsApp Video ….mp4: small enough to be its own proxy, played from the original. */
  ownProxy: '01K7C5M6Q81000000000002QZV',
  /** IMG_4540.MOV: its filmstrip is being made (round 2: the strip says so until the sprite is there). */
  makingFilmstrip: '01K7C5M6Q81000000000002QZW',
  /** DJI_0420.MP4: media couldn't make its filmstrip; the strip says why. */
  filmstripFailed: '01K7C5M6Q81000000000002QZX',
} as const;
