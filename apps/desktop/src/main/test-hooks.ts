// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Hooks for test builds only (TAALCUT_BUILD_FLAVOUR=test). index.ts reaches
 * them only inside `if (__TAALCUT_FLAVOUR__ === 'test')`, so the bundler drops
 * them from release builds; the packaged test checks the release bundle for
 * these switch names.
 *
 *   --taalcut-self-test=vector   open a database in userData with sqlite-vec,
 *                                run a kNN query, print the result, exit
 *   --taalcut-self-test=gpu      print the GpuInfo report, exit
 *   --taalcut-self-test=usb      load the native USB addon and enumerate devices without opening them
 *   --taalcut-self-test=onnx     load ONNX Runtime from the installed component and
 *                                embed one query with EmbeddingGemma 2 (self-test-onnx.ts)
 *   --taalcut-self-test=mac-helper  find the mac helper as the utility processes do (the
 *                                packaged one against the baked pin) and start it
 *                                (self-test-mac-helper.ts)
 *   --taalcut-update-feed=<url>  check this feed (loopback http allowed)
 *   --taalcut-test-crash=<name>  crash main, renderer, agent or jobs 2s after
 *                                the window is shown, or (main-error) leave a
 *                                rejected promise unhandled in main: a JavaScript
 *                                error, not a crash (the call stays in index.ts,
 *                                behind the test flavour)
 */
import { join } from 'node:path';
import { isTaalcutError, type Result } from '@taalcut/core';
import { openDatabase, openVectorIndex, sqliteVecVersion } from '@taalcut/library';
import type { GpuInfo } from './gpu/gpu-info';
import { resolveSqliteVec } from './native/sqlite-vec';

export const SELF_TEST_SWITCH = 'taalcut-self-test';
export const UPDATE_FEED_SWITCH = 'taalcut-update-feed';
/** `--taalcut-test-crash=main|renderer|agent|jobs|main-error`. Absent from release builds. */
export const TEST_CRASH_SWITCH = 'taalcut-test-crash';
/** Prefix of the one stdout line a self-test prints: `TAALCUT_SELF_TEST {json}`. */
export const SELF_TEST_MARKER = 'TAALCUT_SELF_TEST';

/** Runs a self-test, prints its result and returns the exit code. */
export async function runSelfTest(
  name: string,
  context: { readonly workDir: string; readonly gpu: GpuInfo; readonly packaged?: boolean },
): Promise<number> {
  let result: Record<string, unknown>;
  try {
    if (name === 'vector') result = vectorSelfTest(context.workDir);
    else if (name === 'gpu') result = { ...(await context.gpu.read()) };
    else if (name === 'usb') result = await (await import('./self-test-usb')).usbSelfTest();
    else if (name === 'onnx')
      result = await (
        await import('./self-test-onnx')
      ).onnxSelfTest(context.workDir, context.packaged ?? false);
    else if (name === 'mac-helper')
      result = await (
        await import('./self-test-mac-helper')
      ).macHelperSelfTest(context.workDir, context.packaged ?? false);
    else result = { error: `unknown self-test '${name}'` };
  } catch (cause) {
    result = { error: isTaalcutError(cause) ? cause.code : String(cause), detail: describe(cause) };
  }
  process.stdout.write(`${SELF_TEST_MARKER} ${JSON.stringify(result)}\n`);
  return 'error' in result ? 1 : 0;
}

/** sqlite-vec loaded through node:sqlite inside this (signed, hardened) process, and a kNN query. */
function vectorSelfTest(workDir: string): Record<string, unknown> {
  const extension = value(resolveSqliteVec());
  const db = value(openDatabase({ path: join(workDir, 'self-test.db'), extensions: [extension] }));
  try {
    const index = value(openVectorIndex(db, { name: 'self_test', dimensions: 4 }));
    value(
      index.upsert([
        { id: 'east', vector: [1, 0, 0, 0] },
        { id: 'north', vector: [0, 1, 0, 0] },
        { id: 'east-north-east', vector: [0.9, 0.3, 0, 0] },
      ]),
    );
    const matches = value(index.search([1, 0.1, 0, 0], { k: 2 }));
    return {
      extension,
      sqliteVec: sqliteVecVersion(db.driver),
      nearest: matches.map((match) => match.id),
    };
  } finally {
    db.close();
  }
}

function value<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw result.error;
}

function describe(cause: unknown): string {
  if (isTaalcutError(cause)) return cause.detail ?? cause.code;
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Schedules a crash in the named process. The callback is injected; index.ts
 * performs it, and only in a test build.
 */
const TEST_CRASHES = ['main', 'renderer', 'agent', 'jobs', 'main-error'] as const;
export type TestCrash = (typeof TEST_CRASHES)[number];

export function armTestCrash(
  getSwitch: () => string | undefined,
  crash: (name: TestCrash) => void,
  delayMs = 2000,
  schedule: (callback: () => void, delay: number) => unknown = setTimeout,
): void {
  const name = TEST_CRASHES.find((known) => known === getSwitch());
  if (!name) return;
  schedule(() => crash(name), delayMs);
}
