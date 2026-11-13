// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * For the suites whose tests start processes: the bundled FFmpeg or ffprobe (probe a clip, refinish it,
 * blackdetect) or the stall watch's stand-ins (/bin/sh, /usr/bin/true). On the dev Mac under a full parallel
 * load each start takes from a few hundred milliseconds to a few seconds (UX2 round 2, beside other lanes'
 * tests at load 25 to 35: 0.2 to 2.6 s each, against 10 to 100 ms idle; the two stand-ins together passed 5 s),
 * and a test starts up to four, so Vitest's 5 s default doesn't tell a hang from a busy machine for them.
 * Tests that start nothing keep the default.
 */
export const STARTS_PROCESSES = { timeout: 60_000 };
