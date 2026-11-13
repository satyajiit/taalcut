// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * For the tests and hooks that start the bundled FFmpeg or ffprobe to build or probe a fixture. On the dev Mac
 * under a full parallel load each start takes from a few hundred milliseconds to several seconds (UX2 round 2,
 * beside the renderer's tests at load 22 to 26: 0.2 to 5.6 s each, against 10 to 100 ms idle), so Vitest's 5 s
 * test and 10 s hook defaults don't tell a hang from a busy machine for them. The fixture builders start one
 * FFmpeg each; tests that start nothing keep the defaults, and the suites that run whole pipelines keep their
 * own, longer limits.
 */
export const STARTS_PROCESSES = { timeout: 60_000 };
