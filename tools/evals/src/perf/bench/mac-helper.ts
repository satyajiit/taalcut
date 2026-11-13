// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The mac helper preflight. On macOS the app reads on-screen text (OCR) through the mac helper (native/mac-helper,
 * started by the vision root while it analyses shots). A development build that cannot find the helper analyses
 * every shot without text and says nothing, so a bench without it times less work than a user's Mac does: the
 * first IX baselines (2026-10-17) did. So before it builds anything the bench runs the helper the app will use
 * (`--version`), fails when it does not run, and points the app at exactly that file. `--no-mac-helper` benches
 * without it on purpose: the app is pointed at a file that does not exist and the summary says "without OCR".
 *
 * Found the way a development build finds it (packages/media/src/sidecar/resolver.ts): $TAALCUT_MAC_HELPER
 * (absolute), else <repo>/native/mac-helper/dist/taalcut-mac-helper.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { readJson, writeJson } from '../../files';
import { hashFile } from '../../gates/inputs/digest';
import { parseJsonLines } from '../../jsonl';
import { parseNamed } from '../../schema';

export const MAC_HELPER_ENV = 'TAALCUT_MAC_HELPER';
export const MAC_HELPER_NAME = 'taalcut-mac-helper';

/** How a bench was set up for on-screen text; the runner keeps it beside the runs (ocr-setup.json). */
export const ocrSetupSchema = z.object({
  /** `helper`: the app had a helper that ran; `off`: it had none, on purpose or off macOS. */
  mode: z.enum(['helper', 'off']),
  /** sha256 of the file itself: helper builds are not byte-reproducible, so the version alone does not name one. */
  helper: z.object({ path: z.string(), version: z.string(), sha256: z.string().optional() }).nullable(),
  /** Why OCR was off; null with the helper. */
  reason: z.string().nullable(),
});
export type OcrSetup = z.output<typeof ocrSetupSchema>;

export interface HelperProbe {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** `<path> --version`'s standard output; rejects when it cannot run or exits non-zero. */
  readonly version: (path: string) => Promise<string>;
  /** The file's sha256, hex. */
  readonly sha256: (path: string) => string;
}

/** `--version` prints one JSON line: {"version":"1.0.0","protocol":2,"swift":…}. */
const versionSchema = z.looseObject({ version: z.string().min(1) });

const HOW =
  'Build it with native/mac-helper/build.sh, or set TAALCUT_MAC_HELPER to its absolute path; ' +
  '`--no-mac-helper` benches without on-screen text (OCR) and the summary says so.';

/** Where the app's development build looks for the helper. */
export function macHelperPath(env: HelperProbe['env'], repoRoot: string): string {
  const fromEnv = env[MAC_HELPER_ENV]?.trim();
  if (!fromEnv) return join(repoRoot, 'native', 'mac-helper', 'dist', MAC_HELPER_NAME);
  if (!isAbsolute(fromEnv))
    throw new Error(`${MAC_HELPER_ENV} must be an absolute path, not '${fromEnv}'. ${HOW}`);
  return fromEnv;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The version from `--version`'s first line; throws, saying what it printed, for anything else. */
function versionOf(output: string, path: string): string {
  try {
    const [first] = parseJsonLines(output, `${path} --version`, (value) => versionSchema.parse(value));
    if (first !== undefined) return first.version;
  } catch (error) {
    throw new Error(`${message(error)}. ${HOW}`, { cause: error });
  }
  throw new Error(`${path} --version printed nothing. ${HOW}`);
}

/**
 * The helper the app will use, or why there is none. Throws when one is wanted on macOS and it does not run:
 * never a silent bench without OCR.
 */
export async function preflightMacHelper(
  probe: HelperProbe,
  repoRoot: string,
  wanted: boolean,
): Promise<OcrSetup> {
  if (!wanted) return { mode: 'off', helper: null, reason: 'run with --no-mac-helper' };
  if (probe.platform !== 'darwin')
    return { mode: 'off', helper: null, reason: `the mac helper is macOS only (this is ${probe.platform})` };
  const path = macHelperPath(probe.env, repoRoot);
  let output: string;
  try {
    output = await probe.version(path);
  } catch (error) {
    throw new Error(
      `The mac helper does not run (${path} --version: ${message(error)}), so the app would read no ` +
        `on-screen text. ${HOW}`,
      { cause: error },
    );
  }
  return {
    mode: 'helper',
    helper: { path, version: versionOf(output, path), sha256: probe.sha256(path) },
    reason: null,
  };
}

/** What the e2e runs with: the checked helper, or a path that cannot exist so the app finds none. */
export function macHelperEnv(setup: OcrSetup, labelDir: string): Record<string, string> {
  return { [MAC_HELPER_ENV]: setup.helper?.path ?? join(labelDir, 'no-mac-helper', MAC_HELPER_NAME) };
}

export const writeOcrSetup = (path: string, setup: OcrSetup): void => writeJson(path, setup);

/** Null for a bench from before the preflight (it kept no setup). */
export const readOcrSetup = (path: string): OcrSetup | null =>
  existsSync(path) ? parseNamed(ocrSetupSchema, readJson(path), path) : null;

/** The real helper, run as a plain child process (never signalled: no timeout). */
export function nodeHelperProbe(): HelperProbe {
  return {
    platform: process.platform,
    env: process.env,
    version: (path) =>
      new Promise((resolve, reject) => {
        execFile(path, ['--version'], (error, stdout) => (error ? reject(error) : resolve(stdout)));
      }),
    sha256: hashFile,
  };
}
