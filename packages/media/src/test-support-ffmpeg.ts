// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FFmpeg for the repo's test suites, checked once per test run (UX2-FIXUP round 2). Each package that runs
 * FFmpeg in its tests has `provideTestFfmpeg` as a Vitest `globalSetup`: it runs the development resolver's whole
 * check (BUILDINFO.json, the hashes, `-version` and `-L` of both binaries) before any test file starts, and hands
 * the answer to every file through `inject('testFfmpeg')`; the suites read it with `testFfmpegFor`.
 *
 * Why once, and why this deadline. Each suite used to run the check itself, with the app's 10 s per call, as its
 * workers started: on a shared, busy Mac (exec scanning, swap, a package's own workers all starting) a `-version`
 * could take most of that, and a different suite failed each run. The answer is the same for every file of a run
 * (one build), so it's looked for once, before the workers, and with a deadline about FFmpeg hanging rather than
 * the machine being busy: 2 minutes, where a hung binary never answers and a busy one answers in seconds.
 *
 * Only a missing FFmpeg (a checkout or CI without tools/ffmpeg built) lets suites skip, each saying so. Anything
 * else (a build that doesn't match its BUILDINFO.json, a licence, a binary that fails or hangs) stops the
 * package's run in its setup, before any test, with the resolver's code and detail.
 */
import type { TestProject } from 'vitest/node';
import { createBinaryResolver, type ResolvedFfmpeg } from './binaries/resolver';
import { FfmpegNotFound } from './errors';

/** What a test run found: the checked build, or why there is none. */
export type TestFfmpeg =
  | { readonly found: true; readonly binaries: ResolvedFfmpeg }
  | { readonly found: false; readonly missing: string };

declare module 'vitest' {
  export interface ProvidedContext {
    /** provideTestFfmpeg's answer for this run; suites read it with testFfmpegFor. */
    testFfmpeg: TestFfmpeg;
  }
}

/** Each `-version` / `-L` call of the check: long enough that only an FFmpeg that never answers reaches it. */
export const TEST_FFMPEG_CHECK_MS = 120_000;

/** A package's Vitest `globalSetup` (re-exported as default by its test/ffmpeg-setup.ts). */
export async function provideTestFfmpeg(project: TestProject): Promise<void> {
  const result = await createBinaryResolver({ development: true, timeoutMs: TEST_FFMPEG_CHECK_MS }).resolve();
  if (result.ok) {
    project.provide('testFfmpeg', { found: true, binaries: result.value });
    return;
  }
  if (result.error.code !== FfmpegNotFound.code)
    throw new Error(`FFmpeg's check failed (${result.error.code}): ${result.error.detail ?? ''}`);
  const missing = `${result.error.code}: ${result.error.detail ?? ''}`;
  // Once for the run, where it is always shown; each suite that skips says so as well.
  console.warn(`[${project.name || 'tests'}] no FFmpeg found, so the suites that run it skip (${missing})`);
  project.provide('testFfmpeg', { found: false, missing });
}

/**
 * The run's FFmpeg for one suite: `{ binaries }`, or `{ skip }` with the reason (also printed) when the run found
 * none. Pass `inject('testFfmpeg')`; undefined means the package's config doesn't run the setup, which is an error.
 */
export function testFfmpegFor(
  provided: TestFfmpeg | undefined,
  suite: string,
): { readonly binaries?: ResolvedFfmpeg; readonly skip: string } {
  if (provided === undefined)
    throw new Error(
      `${suite}: no FFmpeg check ran for this test run: add test/ffmpeg-setup.ts (provideTestFfmpeg from ` +
        "@taalcut/media/test-support) to the package's Vitest globalSetup",
    );
  if (provided.found) return { binaries: provided.binaries, skip: '' };
  const skip =
    `${suite}: skipped, no FFmpeg found (${provided.missing}). ` +
    'Build tools/ffmpeg (build.sh) or set TAALCUT_FFMPEG_DIR to run it.';
  console.warn(skip);
  return { skip };
}
