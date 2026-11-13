// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Reads a downloaded update before Squirrel.Mac sees it. The zip
 * the update library fetched (and sha512-checked) is first copied into a
 * private snapshot (snapshot.ts); the snapshot is unpacked into a scratch
 * folder, where the bundle must be exactly Taalcut.app with a valid code
 * signature. Its version and team are read and candidate.ts's rules applied
 * against the running app; then the signature must also satisfy a
 * requirement naming the running app's team and identifier, so no text
 * codesign prints decides trust. Last, the snapshot must still have the hash
 * it was written with. The verdict carries the snapshot, which is what gets
 * staged.
 *
 * Everything runs as child processes; main's event loop isn't blocked. The
 * scratch copy is always removed, with /bin/rm: Electron's fs treats the
 * copy's app.asar as a directory, so fs.rm fails on it (ENOTEMPTY).
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { err, ok, type Result } from '@taalcut/core';
import {
  checkCandidate,
  UpdateChanged,
  UpdateUnreadable,
  UpdateUntrustedSigner,
  type BundleIdentity,
} from './candidate';
import { sha512Of, snapshotOf, type Snapshot } from './snapshot';

/** Runs a command; rejects on a non-zero exit. */
export type Exec = (command: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFile);
export const runExec: Exec = (command, args) =>
  execFileAsync(command, [...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });

/** The one thing an update zip may hold (electron-builder's mac zip of the app). */
export const UPDATE_BUNDLE = 'Taalcut.app';
const TEAM_ID = /^[A-Z0-9]{10}$/;
const BUNDLE_ID = /^[A-Za-z0-9.-]+$/;

/** /X/Taalcut.app/Contents/MacOS/Taalcut → /X/Taalcut.app */
export function appBundleOf(executable: string): string {
  return resolve(executable, '..', '..', '..');
}

async function plistValue(appPath: string, key: string, exec: Exec): Promise<string> {
  const plist = join(appPath, 'Contents', 'Info.plist');
  const { stdout } = await exec('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist]);
  return stdout.trim();
}

/**
 * The team in `codesign -dv` output. codesign prints paths raw, so a name
 * with a newline can add a line of its own: anything but exactly one
 * TeamIdentifier line is unreadable, and only a well-formed team counts.
 */
export function teamOf(codesignOutput: string): string | undefined {
  const lines = codesignOutput.split('\n').filter((line) => line.startsWith('TeamIdentifier='));
  if (lines.length !== 1) throw new Error(`codesign reported ${lines.length} TeamIdentifier lines`);
  const team = (lines[0] ?? '').slice('TeamIdentifier='.length).trim();
  return TEAM_ID.test(team) ? team : undefined;
}

/** Version from Info.plist, team from the code signature (undefined for ad-hoc or unsigned code). */
export async function readBundleIdentity(appPath: string, exec: Exec = runExec): Promise<BundleIdentity> {
  const version = await plistValue(appPath, 'CFBundleShortVersionString', exec);
  // codesign -d reports on stderr.
  const { stderr } = await exec('/usr/bin/codesign', ['-dv', '--verbose=2', appPath]);
  return { version, team: teamOf(stderr) };
}

/** What Squirrel's own check asks for too: Apple-anchored, our identifier, our team. */
export function teamRequirement(team: string, identifier: string): string {
  if (!TEAM_ID.test(team) || !BUNDLE_ID.test(identifier)) {
    throw new Error(`not a team and bundle identifier: ${JSON.stringify([team, identifier])}`);
  }
  return `=anchor apple generic and identifier "${identifier}" and certificate leaf[subject.OU] = "${team}"`;
}

export interface VerifiedUpdate {
  readonly identity: BundleIdentity;
  /** The verified bytes; the caller stages them and disposes of them. */
  readonly snapshot: Snapshot;
}

export type DownloadVerifier = (downloadedZip: string) => Promise<Result<VerifiedUpdate>>;

export function createDownloadVerifier(options: {
  /** The running Taalcut.app. */
  readonly runningApp: string;
  /** app.getVersion() */
  readonly runningVersion: string;
  readonly exec?: Exec;
  readonly scratchRoot?: string;
}): DownloadVerifier {
  const exec = options.exec ?? runExec;
  const root = options.scratchRoot ?? tmpdir();

  async function check(snapshot: Snapshot, scratch: string): Promise<Result<BundleIdentity>> {
    const running = await readBundleIdentity(options.runningApp, exec);
    await exec('/usr/bin/ditto', ['-x', '-k', snapshot.path, scratch]);
    const entries = await readdir(scratch);
    if (!entries.some((name) => name.endsWith('.app'))) {
      return err(UpdateUnreadable(undefined, { detail: `no app in the update: ${JSON.stringify(entries)}` }));
    }
    if (entries.length !== 1 || entries[0] !== UPDATE_BUNDLE) {
      return err(
        UpdateUntrustedSigner(
          { team: 'unverified', expected: running.team ?? 'none' },
          { detail: `an update holds ${UPDATE_BUNDLE} and nothing else, not ${JSON.stringify(entries)}` },
        ),
      );
    }
    const candidateApp = join(scratch, UPDATE_BUNDLE);
    await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', candidateApp]);
    const candidate = await readBundleIdentity(candidateApp, exec);
    const verdict = checkCandidate({ ...running, version: options.runningVersion }, candidate);
    if (!verdict.ok || running.team === undefined) return verdict;
    const identifier = await plistValue(options.runningApp, 'CFBundleIdentifier', exec);
    const requirement = teamRequirement(running.team, identifier);
    const satisfied = await exec('/usr/bin/codesign', [
      '--verify',
      '--deep',
      '--strict',
      '-R',
      requirement,
      candidateApp,
    ]).then(
      () => true,
      () => false,
    );
    if (!satisfied) {
      return err(
        UpdateUntrustedSigner(
          { team: 'unverified', expected: running.team },
          { detail: `the signature does not satisfy ${requirement.slice(1)}` },
        ),
      );
    }
    return verdict;
  }

  return async (downloadedZip) => {
    let snapshot: Snapshot;
    try {
      snapshot = await snapshotOf(downloadedZip, root);
    } catch (cause) {
      return err(
        UpdateUnreadable(undefined, { detail: cause instanceof Error ? cause.message : String(cause) }),
      );
    }
    let scratch: string | undefined;
    let verdict: Result<BundleIdentity>;
    try {
      scratch = await mkdtemp(join(root, 'taalcut-update-check-'));
      verdict = await check(snapshot, scratch);
      if (verdict.ok && (await sha512Of(snapshot.path)) !== snapshot.sha512) {
        verdict = err(UpdateChanged(undefined, { detail: 'the snapshot changed while it was verified' }));
      }
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      verdict = err(UpdateUnreadable(undefined, { detail }));
    } finally {
      // A leftover copy in the temp folder must not turn a verdict into an error.
      if (scratch) await runExec('/bin/rm', ['-rf', scratch]).catch(() => undefined);
    }
    if (verdict.ok) return ok({ identity: verdict.value, snapshot });
    await snapshot.dispose().catch(() => undefined);
    return verdict;
  };
}
