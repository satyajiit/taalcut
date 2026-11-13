// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where a desktop build puts its output, in one place for the packaging config and the scripts that run after it
 * (scripts/verify-signature.mjs). It imports only Node's built-ins, with no bare specifiers, so a plain .mjs script
 * can import this file as it is (Node strips the types).
 *
 *   out/build-info.json              the bundles' build settings (build-settings.ts), so the flavour packaged
 *   release/                         electron-builder's output for a release build
 *   release/test/                    for a test build
 *   $TAALCUT_PACKAGE_OUTPUT          instead of either, when set (the update e2e's N+1 and the like)
 *   <output>/mac-arm64/Taalcut.app   the app; DMGs and zips beside mac-arm64/
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type BuildFlavour = 'release' | 'test';

export const BUILD_INFO_FILE = join('out', 'build-info.json');

/** release/ or release/test/, unless TAALCUT_PACKAGE_OUTPUT says otherwise; relative to apps/desktop. */
export function outputDir(settings: { readonly flavour: BuildFlavour }, env: NodeJS.ProcessEnv = {}): string {
  return (
    env.TAALCUT_PACKAGE_OUTPUT?.trim() || (settings.flavour === 'test' ? join('release', 'test') : 'release')
  );
}

/** The flavour out/build-info.json records: what the last desktop build bundled, and so what packaging packed. */
export function builtFlavour(projectDir: string): BuildFlavour {
  const file = join(projectDir, BUILD_INFO_FILE);
  if (!existsSync(file)) throw new Error(`${file} not found: run the desktop build before packaging.`);
  const { flavour } = JSON.parse(readFileSync(file, 'utf8')) as { flavour?: unknown };
  if (flavour !== 'release' && flavour !== 'test')
    throw new Error(`${file}: flavour must be 'release' or 'test', got ${JSON.stringify(flavour)}`);
  return flavour;
}

/**
 * The output directory of the last build's flavour, as a path: an absolute TAALCUT_PACKAGE_OUTPUT as it is (as
 * electron-builder takes it), a relative one from `projectDir`.
 */
export function packageOutput(projectDir: string, env: NodeJS.ProcessEnv = {}): string {
  return resolve(projectDir, outputDir({ flavour: builtFlavour(projectDir) }, env));
}

/**
 * What the last package made, for scripts/verify-signature.mjs: the app in the flavour's output directory and, unless
 * `appOnly` (a --dir build makes no DMG, and an older one beside it isn't this build's), the DMGs there. Missing
 * files are left out.
 */
export function packagedArtifacts(
  projectDir: string,
  env: NodeJS.ProcessEnv = {},
  options: { readonly appOnly?: boolean } = {},
): string[] {
  const output = packageOutput(projectDir, env);
  const app = join(output, 'mac-arm64', 'Taalcut.app');
  const dmgs =
    options.appOnly || !existsSync(output)
      ? []
      : readdirSync(output)
          .filter((name) => name.endsWith('.dmg'))
          .sort()
          .map((name) => join(output, name));
  return [...(existsSync(app) ? [app] : []), ...dmgs];
}
