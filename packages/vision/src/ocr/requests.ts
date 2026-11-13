// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How one engine call's frames become helper requests (IX3-O2). The helper reads a request's images one after
 * another and runs `inFlight` requests at once, so a call ends when its longest request does. Cutting in
 * 16-frame pieces in order left slots idle: a window of 13 changed frames was one request (one slot read,
 * the other waited), and 45 frames ran 16 ‖ 16, then 13 alone. Here a call takes as many requests as 16-frame
 * pieces would, rounded up to a whole number of rounds of `inFlight`, with sizes as equal as possible:
 * 13 frames are 7 ‖ 6, 45 are 12 ‖ 11 then 11 ‖ 11. Every frame is read once, in the same request order, so
 * the pages are the same.
 */

/** Request sizes, in frame order, for `count` frames with `inFlight` requests at once and at most `max` each. */
export function requestSizes(count: number, inFlight: number, max: number): number[] {
  if (count <= 0) return [];
  const pieces = Math.ceil(count / Math.max(1, max));
  const parallel = Math.max(1, inFlight);
  const requests = Math.min(count, Math.ceil(pieces / parallel) * parallel);
  const base = Math.floor(count / requests);
  const longer = count % requests;
  return Array.from({ length: requests }, (_, i) => base + (i < longer ? 1 : 0));
}

/** The requests as `[start, end)` frame ranges. */
export function requestRanges(count: number, inFlight: number, max: number): [number, number][] {
  const ranges: [number, number][] = [];
  let start = 0;
  for (const size of requestSizes(count, inFlight, max)) {
    ranges.push([start, start + size]);
    start += size;
  }
  return ranges;
}
