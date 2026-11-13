// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Distribution hooks (P1-B3): notarise and staple the app and the DMG, and
 * sign the DMG.
 *
 * Credentials: an App Store Connect API key the owner stores once in the
 * login keychain as a notarytool profile:
 *   xcrun notarytool store-credentials taalcut-notary --key AuthKey_<id>.p8 --key-id <id> --issuer <issuer>
 * The build only ever names the profile (TAALCUT_NOTARY_PROFILE, default
 * taalcut-notary); notarytool reads the key from the keychain. A build whose
 * profile lives in another keychain names it with TAALCUT_NOTARY_KEYCHAIN
 * (passed to notarytool as --keychain).
 *
 * Notarisation runs only for Developer ID signed release builds whose
 * profile exists, and not with TAALCUT_NOTARIZE=0 (the e2e builds set it).
 * Otherwise the build says why it skipped, or, with TAALCUT_NOTARIZE=1 (the
 * release workflow), fails.
 *
 *   afterSign              notarise + staple the .app, before the zip and
 *                          DMG are made from it
 *   afterAllArtifactBuild  sign the DMG (timestamped; electron-builder's own
 *                          DMG signing has no timestamp), notarise + staple it
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { AfterPackContext, BuildResult } from 'electron-builder';
import type { BuildFlavour } from './build-settings';
import { runChecked, runCommand, type Run } from './run';
import { AD_HOC } from './signing';

export const DEFAULT_NOTARY_PROFILE = 'taalcut-notary';

export function notaryProfile(env: NodeJS.ProcessEnv): string {
  return env.TAALCUT_NOTARY_PROFILE?.trim() || DEFAULT_NOTARY_PROFILE;
}

/** The notarytool profile, and the keychain file holding it when it isn't the default keychain. */
export interface NotaryCredentials {
  readonly profile: string;
  readonly keychain?: string;
}

export function notaryCredentials(env: NodeJS.ProcessEnv): NotaryCredentials {
  const keychain = env.TAALCUT_NOTARY_KEYCHAIN?.trim();
  return { profile: notaryProfile(env), ...(keychain ? { keychain } : {}) };
}

/** notarytool's authentication arguments: the profile name and, if set, the keychain path. Never a secret. */
export function credentialArgs(credentials: NotaryCredentials): string[] {
  const keychain = credentials.keychain ? ['--keychain', credentials.keychain] : [];
  return ['--keychain-profile', credentials.profile, ...keychain];
}

/** True if notarytool finds the profile in the keychain. Its output is discarded, never printed. */
export function keychainProfileExists(credentials: NotaryCredentials, run: Run = runCommand): boolean {
  return (
    run('xcrun', ['notarytool', 'history', ...credentialArgs(credentials), '--output-format', 'json'])
      .status === 0
  );
}

export type NotaryDecision =
  | { readonly notarize: true; readonly credentials: NotaryCredentials }
  | { readonly notarize: false; readonly reason: string };

function skipReason(
  env: NodeJS.ProcessEnv,
  identity: string,
  flavour: BuildFlavour,
  credentials: NotaryCredentials,
  profileExists: (credentials: NotaryCredentials) => boolean,
): string | undefined {
  if (identity === AD_HOC) return 'the build is signed ad-hoc; set TAALCUT_MAC_IDENTITY to a Developer ID';
  if (flavour === 'test') return 'test builds are never notarised';
  if (env.TAALCUT_NOTARIZE?.trim() === '0') return 'TAALCUT_NOTARIZE=0';
  if (profileExists(credentials)) return undefined;
  const where = credentials.keychain ? ` in ${credentials.keychain}` : '';
  return (
    `keychain profile "${credentials.profile}" not found${where}. Store it once with: ` +
    `xcrun notarytool store-credentials ${credentials.profile} --key AuthKey_<id>.p8 --key-id <id> --issuer <issuer>`
  );
}

/** Notarise, or skip and say why. TAALCUT_NOTARIZE=1 turns every skip into an error. */
export function notaryDecision(options: {
  env: NodeJS.ProcessEnv;
  identity: string;
  flavour: BuildFlavour;
  profileExists: (credentials: NotaryCredentials) => boolean;
}): NotaryDecision {
  const { env, identity, flavour, profileExists } = options;
  const credentials = notaryCredentials(env);
  const reason = skipReason(env, identity, flavour, credentials, profileExists);
  if (reason === undefined) return { notarize: true, credentials };
  if (env.TAALCUT_NOTARIZE?.trim() === '1') {
    throw new Error(`TAALCUT_NOTARIZE=1, but notarisation would be skipped: ${reason}`);
  }
  return { notarize: false, reason };
}

interface Submission {
  readonly id?: string;
  readonly status?: string;
  readonly message?: string;
}

function parseSubmission(stdout: string): Submission {
  try {
    return JSON.parse(stdout) as Submission;
  } catch {
    return {};
  }
}

/** Submits an .app (zipped with ditto) or .dmg, waits for the verdict, then staples the ticket. */
export function notarizeAndStaple(
  path: string,
  credentials: NotaryCredentials,
  run: Run = runCommand,
  log: (message: string) => void = (message) => console.warn(message),
): void {
  const name = basename(path);
  const scratch = path.endsWith('.app') ? mkdtempSync(join(tmpdir(), 'taalcut-notary-')) : undefined;
  try {
    const upload = scratch ? join(scratch, `${name}.zip`) : path;
    if (scratch) {
      runChecked(
        run,
        'ditto',
        ['-c', '-k', '--sequesterRsrc', '--keepParent', path, upload],
        `zipping ${name}`,
      );
    }
    log(`notarising ${name} (notarytool, profile ${credentials.profile}); this can take several minutes`);
    const args = [
      'notarytool',
      'submit',
      upload,
      ...credentialArgs(credentials),
      '--wait',
      '--output-format',
      'json',
    ];
    const result = run('xcrun', args);
    const submission = parseSubmission(result.stdout);
    if (result.status !== 0 || submission.status !== 'Accepted') {
      const details = submission.id
        ? run('xcrun', ['notarytool', 'log', submission.id, ...credentialArgs(credentials)]).stdout
        : result.stderr;
      throw new Error(
        `notarisation of ${name} failed: ${submission.status ?? `notarytool exited ${result.status}`}` +
          `${submission.message ? ` (${submission.message})` : ''}\n${details.trim()}`,
      );
    }
    log(`notarised ${name}: submission ${submission.id ?? '?'} Accepted`);
    runChecked(run, 'xcrun', ['stapler', 'staple', path], `stapling ${name}`);
    log(`stapled the ticket to ${name}`);
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

export interface DistributionHooks {
  afterSign(context: AfterPackContext): Promise<void>;
  afterAllArtifactBuild(result: BuildResult): Promise<string[]>;
}

export function createDistributionHooks(options: {
  env: NodeJS.ProcessEnv;
  identity: string;
  flavour: BuildFlavour;
  run?: Run;
  log?: (message: string) => void;
  profileExists?: (credentials: NotaryCredentials) => boolean;
}): DistributionHooks {
  const { env, identity, flavour, run = runCommand, log = (message) => console.warn(message) } = options;
  const profileExists =
    options.profileExists ?? ((credentials: NotaryCredentials) => keychainProfileExists(credentials, run));
  let decided: NotaryDecision | undefined;
  const decide = (): NotaryDecision =>
    (decided ??= notaryDecision({ env, identity, flavour, profileExists }));

  return {
    async afterSign(context) {
      if (context.electronPlatformName !== 'darwin') return;
      const decision = decide();
      if (!decision.notarize) {
        log(`notarisation skipped: ${decision.reason}`);
        return;
      }
      const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
      notarizeAndStaple(app, decision.credentials, run, log);
    },

    async afterAllArtifactBuild(result) {
      // An ad-hoc DMG stays unsigned: an ad-hoc signature on it proves nothing.
      if (identity === AD_HOC) return [];
      for (const dmg of result.artifactPaths.filter((path) => path.endsWith('.dmg'))) {
        runChecked(
          run,
          'codesign',
          ['--force', '--sign', identity, '--timestamp', dmg],
          `signing ${basename(dmg)}`,
        );
        log(`signed ${basename(dmg)} (${identity}, timestamped)`);
        const decision = decide();
        if (decision.notarize) notarizeAndStaple(dmg, decision.credentials, run, log);
      }
      return [];
    },
  };
}
