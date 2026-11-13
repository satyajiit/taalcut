// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Repeatable conversions (IX2-F15). FFmpeg 9.0.2 converts YUV at its own size to gray or RGB in slices over the
 * filter graph's threads, and the bytes aren't repeatable when the rows don't split evenly over them: on this Mac's
 * 18 cores (FFmpeg's default 19 slice threads) BT.709-tagged NV12 to gray at 256×144, 640×360 and 1280×720, and any
 * tagged NV12 to rgb24 at those sizes, came out different almost every run, while 2, 3, 4, 6, 12 or 18 threads, or
 * one, gave the same bytes every time (8 and 16 threads failed where they leave a slice an odd number of rows).
 * YUV-to-YUV conversions (JPEG, yuv420p) and conversions that also scale repeated at every count. On one thread the
 * bytes repeat on any Mac and are the bytes an even split gives (`_orch/ix2/logs/fix2/f15/knobs*.out`), so only the
 * conversions at a frame's own size run on one thread; scales keep theirs.
 */

/**
 * Before a filter graph (`-filter_complex` or `-vf`): every scale in it, the conversions FFmpeg inserts for an
 * output's pixel format included, on one thread. Only for graphs whose CPU scales are small (frames scaled on the
 * device, or a model's input): an explicit scale takes it too. `bicubic` is the scaler's default.
 */
export const ONE_THREAD_SCALES = 'sws_flags=bicubic:threads=1;';

/** A scale that only converts the frames to what follows (gray for the analysis filters), on one thread. */
export const CONVERT_ONE_THREAD = 'scale=threads=1';
