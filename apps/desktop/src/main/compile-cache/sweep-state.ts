// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the compile sweep saw last time (IX3-B6): the Core ML component folders installed when it last ran, in
 * `<userData>/compile-cache.json`. A folder recorded there and gone now is a version the app no longer has, whose
 * compile is orphaned. A missing or unreadable file is "never swept": the first start records and removes nothing.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

export const SWEEP_STATE_FILE = 'compile-cache.json';

const stateSchema = z.object({
  v: z.literal(1),
  /** Core ML component folders, relative to the components root, sorted. */
  coreMlComponents: z.array(z.string()),
  sweptAt: z.string(),
});
export type SweepState = z.output<typeof stateSchema>;

/** The file's text: JSON of the state's shape. Anything else (a file torn by a crash, a foreign one) fails. */
const stateFile = z
  .string()
  .transform((text, context): unknown => {
    try {
      return JSON.parse(text);
    } catch (error) {
      context.addIssue({ code: 'custom', message: `not JSON: ${String(error)}` });
      return z.NEVER;
    }
  })
  .pipe(stateSchema);

export const sweepStatePath = (userData: string): string => join(userData, SWEEP_STATE_FILE);

const isMissing = (cause: unknown) => cause instanceof Error && 'code' in cause && cause.code === 'ENOENT';

/** The state, or null when never written (a first start); an unreadable file reads as a first start too. */
export async function readSweepState(path: string): Promise<SweepState | null> {
  const text = await readFile(path, 'utf8').catch((cause: unknown) => {
    if (isMissing(cause)) return null;
    // Any other read error fails the sweep, which then keeps every compile.
    throw cause;
  });
  if (text === null) return null;
  // A torn or foreign file records and removes nothing, as a first start does, and the sweep rewrites it.
  const parsed = stateFile.safeParse(text);
  return parsed.success ? parsed.data : null;
}

/** Written whole and renamed into place, so a crash leaves the old file or the new one. */
export async function writeSweepState(path: string, state: SweepState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`);
  await rename(temp, path);
}
