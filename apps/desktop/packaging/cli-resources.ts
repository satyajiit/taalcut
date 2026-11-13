// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `taalcut` command-line tool (native/taalcut-cli: the MCP stdio shim and the update guard), shipped at
 * Taalcut.app/Contents/Resources/bin/taalcut. Not in Contents/MacOS: the app's own executable `Taalcut` is
 * there and APFS is case-insensitive by default. afterPack signs it with the other sidecars (sidecars.ts).
 *
 * Packaged when native/taalcut-cli/dist has been built (`native/taalcut-cli/build.sh`). A build that ships
 * updates sets TAALCUT_REQUIRE_CLI=1, so a release without the rollback guard fails instead of shipping.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FileSet } from 'electron-builder';
import { SIDECAR_DESTINATION } from './sidecars';

export const TAALCUT_CLI_BINARY = 'taalcut';

export function taalcutCliDist(projectDir: string): string {
  return join(projectDir, '..', '..', 'native', 'taalcut-cli', 'dist');
}

/** extraResources entry for bin/taalcut; its BUILDINFO stays next to the build. */
export function taalcutCliResources(projectDir: string, env: NodeJS.ProcessEnv = {}): FileSet[] {
  const directory = taalcutCliDist(projectDir);
  if (existsSync(join(directory, TAALCUT_CLI_BINARY))) {
    return [{ from: directory, to: SIDECAR_DESTINATION, filter: [TAALCUT_CLI_BINARY] }];
  }
  if (env.TAALCUT_REQUIRE_CLI?.trim() === '1') {
    throw new Error(`${directory}/${TAALCUT_CLI_BINARY} is missing: run native/taalcut-cli/build.sh first`);
  }
  return [];
}
