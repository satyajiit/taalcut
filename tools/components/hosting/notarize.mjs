#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Step 2 of a components release (README.md, "Releasing components"): every component whose Mach-O files Taalcut
 * signed, notarised by Apple before it is hosted. Each one is unpacked as the app installs it, zipped with ditto
 * and submitted with notarytool; the verdict is read from notarytool's JSON (`status`), never from its exit code,
 * and the submission's log must list no issues and a ticket for every Mach-O file. A hosted file is a bare
 * executable or an archive, which can't carry a stapled ticket: Gatekeeper looks the ticket up online by each
 * file's code directory hash. The submission ids go into release.json, and upload.mjs refuses a release without
 * them.
 *
 *   node tools/components/hosting/notarize.mjs [--release <release.json>] [--only id,id]
 *
 * Credentials, as for the app (apps/desktop/packaging/notarize.ts): the notarytool keychain profile
 * TAALCUT_NOTARY_PROFILE (default taalcut-notary), in TAALCUT_NOTARY_KEYCHAIN when it isn't the default keychain.
 * Only the profile's name is ever passed; a missing profile fails the run.
 */
import { spawn } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { extract } from './archive.mjs';
import { artifactPlan } from './artifacts.mjs';
import { PLAN } from './plan.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const DEFAULT_NOTARY_PROFILE = 'taalcut-notary';

export function notaryCredentials(env) {
  const keychain = env.TAALCUT_NOTARY_KEYCHAIN?.trim();
  return {
    profile: env.TAALCUT_NOTARY_PROFILE?.trim() || DEFAULT_NOTARY_PROFILE,
    ...(keychain ? { keychain } : {}),
  };
}

/** notarytool's authentication arguments: the profile's name and, if set, the keychain's path. Never a secret. */
export function credentialArgs({ profile, keychain }) {
  return ['--keychain-profile', profile, ...(keychain ? ['--keychain', keychain] : [])];
}

/** Runs a command to completion: { status, stdout, stderr }. */
export function runCommand(command, args) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', fail);
    child.on('close', (status) => done({ status, stdout, stderr }));
  });
}

function parseJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return {};
  }
}

/** Throws unless notarytool finds the profile. notarytool's output is discarded, never printed. */
export async function checkProfile(credentials, { xcrun = 'xcrun', run = runCommand } = {}) {
  const args = ['notarytool', 'history', ...credentialArgs(credentials), '--output-format', 'json'];
  if ((await run(xcrun, args)).status === 0) return;
  const where = credentials.keychain ? ` in ${credentials.keychain}` : '';
  throw new Error(
    `notarytool keychain profile "${credentials.profile}" not found${where}; store it once with ` +
      `xcrun notarytool store-credentials ${credentials.profile} --key AuthKey_<id>.p8 --key-id <id> --issuer <issuer>`,
  );
}

/** What's wrong with an Accepted submission's log (empty: nothing): issues, or Mach-O files without a ticket. */
export function logProblems(log, machO) {
  const problems = [];
  if (log.status !== 'Accepted') problems.push(`the log says ${log.status ?? 'nothing'}`);
  for (const issue of log.issues ?? [])
    problems.push(
      `${issue.severity ?? 'issue'}: ${issue.path ?? '?'}: ${issue.message ?? JSON.stringify(issue)}`,
    );
  const ticketed = new Set((log.ticketContents ?? []).map((entry) => entry.path)).size;
  if (ticketed < machO)
    problems.push(`tickets for ${ticketed} files, the component has ${machO} Mach-O files`);
  return problems;
}

/**
 * Submits the folder `dir` (zipped with its own name on top) and waits for Apple's verdict. Resolves to
 * { id, status, tickets } when Accepted with a clean log; throws with the log's issues otherwise.
 */
export async function notarizeFolder(
  dir,
  { machO, credentials, scratch, xcrun = 'xcrun', run = runCommand, log },
) {
  const name = dir.split('/').at(-1);
  const zip = join(scratch, `${name}.zip`);
  const zipped = await run('/usr/bin/ditto', ['-c', '-k', '--keepParent', dir, zip]);
  if (zipped.status !== 0) throw new Error(`ditto could not zip ${name}: ${zipped.stderr.trim()}`);
  log(`${name}: submitted to notarytool (profile ${credentials.profile}); waiting for Apple`);
  const auth = credentialArgs(credentials);
  const submitted = await run(xcrun, [
    'notarytool',
    'submit',
    zip,
    ...auth,
    '--wait',
    '--output-format',
    'json',
  ]);
  const submission = parseJson(submitted.stdout);
  if (!submission.id)
    throw new Error(`${name}: notarytool gave no submission id: ${submitted.stderr.trim()}`);
  const fetched = await run(xcrun, ['notarytool', 'log', submission.id, ...auth]);
  const notaryLog = parseJson(fetched.stdout);
  if (submission.status !== 'Accepted')
    throw new Error(
      `${name}: submission ${submission.id} is ${submission.status ?? 'unknown'}` +
        `${submission.message ? ` (${submission.message})` : ''}:\n  ${logProblems(notaryLog, 0).join('\n  ')}`,
    );
  const problems = logProblems(notaryLog, machO);
  if (problems.length > 0)
    throw new Error(`${name}: submission ${submission.id} was accepted, but:\n  ${problems.join('\n  ')}`);
  return { id: submission.id, status: submission.status, tickets: notaryLog.ticketContents.length };
}

/** The components notarisation is for: Taalcut signed their Mach-O files (an upstream team notarises its own). */
export function needsNotarisation(component, plan = PLAN) {
  const own = plan[component.id];
  return (
    own !== undefined &&
    !component.elsewhere &&
    artifactPlan(own, component.platform).signature === 'taalcut' &&
    component.machO > 0
  );
}

/** What upload.mjs refuses: a component that needs notarisation without an Accepted record for its bytes. */
export function notarisationProblems(release, { plan = PLAN, only = new Set() } = {}) {
  return release.components
    .filter((component) => needsNotarisation(component, plan) && (only.size === 0 || only.has(component.id)))
    .filter((c) => c.notarisation?.status !== 'Accepted' || c.notarisation.sha256 !== c.sha256)
    .map((c) => `${c.id} ${c.version} is not notarised (run notarize.mjs)`);
}

/** Unpacks a component's hosted file the way the app installs it, into `<scratch>/<id>-<version>`. */
async function unpack(component, release, scratch) {
  const object = release.objects.find((o) => o.key === new URL(component.url).pathname.slice(1));
  if (!object) throw new Error(`${component.id}: its file is not among release.json's objects`);
  const dir = join(scratch, `${component.id}-${component.version}`);
  if (component.install.type === 'archive') await extract(object.path, component.install.format, dir);
  else {
    await mkdir(dir, { recursive: true });
    await copyFile(object.path, join(dir, component.install.fileName));
    await chmod(join(dir, component.install.fileName), 0o755);
  }
  return dir;
}

/**
 * Notarises every component of `release` that needs it and isn't yet notarised for its bytes, recording
 * { id, status, sha256, tickets } as its `notarisation`. Returns the release, changed in place.
 */
export async function notarizeRelease(
  release,
  { only = new Set(), credentials, xcrun, run, plan = PLAN, log = console.log },
) {
  await checkProfile(credentials, { xcrun, run });
  for (const component of release.components) {
    if (!needsNotarisation(component, plan) || (only.size > 0 && !only.has(component.id))) continue;
    if (component.notarisation?.status === 'Accepted' && component.notarisation.sha256 === component.sha256) {
      log(`${component.id}: notarised already (${component.notarisation.id})`);
      continue;
    }
    const scratch = await mkdtemp(join(tmpdir(), 'taalcut-notary-'));
    try {
      const dir = await unpack(component, release, scratch);
      const result = await notarizeFolder(dir, {
        machO: component.machO,
        credentials,
        scratch,
        xcrun,
        run,
        log,
      });
      component.notarisation = { ...result, sha256: component.sha256 };
      log(`${component.id}: ${result.status}, submission ${result.id}, ${result.tickets} tickets`);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
  return release;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { release: { type: 'string' }, only: { type: 'string' } } });
  const path = resolve(
    values.release ?? join(REPO, 'tools', 'components', '.cache', 'release', 'release.json'),
  );
  const only = new Set(values.only ? values.only.split(',').map((id) => id.trim()) : []);
  try {
    const release = JSON.parse(await readFile(path, 'utf8'));
    const save = () => writeFile(path, `${JSON.stringify(release, null, 2)}\n`);
    try {
      await notarizeRelease(release, { only, credentials: notaryCredentials(process.env) });
    } finally {
      await save();
    }
    const left = notarisationProblems(release, { only });
    if (left.length > 0) throw new Error(left.join('; '));
  } catch (error) {
    console.error(`notarize: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
