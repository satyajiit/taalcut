// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Test builds only: the folder a test switch names (TAALCUT_TEST_NETWORK_LOG, TAALCUT_TEST_LOCAL_SESSION). */
import { isAbsolute } from 'node:path';

/** The folder the variable names, or undefined when it isn't set. Throws when it isn't an absolute path. */
export function testEnvDir(
  name: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const dir = env[name];
  if (!dir) return undefined;
  if (!isAbsolute(dir)) throw new Error(`${name} must be an absolute path`);
  return dir;
}
