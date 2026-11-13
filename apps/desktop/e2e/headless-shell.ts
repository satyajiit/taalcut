// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The chrome-headless-shell the make e2e renders with, where HyperFrames' own download keeps it.
 * Development machines have it after `pnpm --filter @taalcut/render test`; e2e:provision
 * (provision-assets.ts) extracts the signed manifest's `hyperframes-headless-shell` component there when it
 * is missing.
 *
 * Playwright cannot load render's public entry point because its dependency graph includes JSON imports.
 * test/e2e-headless-shell.test.ts guards this lightweight pin against that public API. An explicit
 * TAALCUT_HEADLESS_SHELL uses an isolated fixture's verified copy; a broken explicit path fails clearly.
 */
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const VERSION = '157.0.8103.50';
const BUILDS: Readonly<Record<string, { readonly top: string; readonly cache: string }>> = {
  'darwin-arm64': { top: 'chrome-headless-shell-mac-arm64', cache: 'mac_arm' },
  'linux-x64': { top: 'chrome-headless-shell-linux64', cache: 'linux' },
};
const build = BUILDS[`${process.platform}-${process.arch}`];

export const HEADLESS_SHELL = {
  version: VERSION,
  binary: join(build?.top ?? 'no-build-for-this-host', 'chrome-headless-shell'),
  supported: build !== undefined,
} as const;

/** HyperFrames' download folder for the pinned shell. */
export const DOWNLOADED_SHELL = join(
  homedir(),
  '.cache',
  'hyperframes',
  'chrome',
  'chrome-headless-shell',
  `${build?.cache ?? 'none'}-${VERSION}`,
);

const explicit = process.env.TAALCUT_HEADLESS_SHELL;
export const SHELL_BINARY = explicit || join(DOWNLOADED_SHELL, HEADLESS_SHELL.binary);

export function shellAvailable(): boolean {
  if (explicit) {
    try {
      if (!statSync(explicit).isFile()) throw new Error('not a file');
      accessSync(explicit, constants.X_OK);
    } catch {
      throw new Error(`TAALCUT_HEADLESS_SHELL is not an executable file: ${explicit}`);
    }
  }
  return HEADLESS_SHELL.supported && existsSync(SHELL_BINARY);
}
