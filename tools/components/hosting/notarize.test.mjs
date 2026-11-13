// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  checkProfile,
  credentialArgs,
  logProblems,
  notarisationProblems,
  notarizeRelease,
  notaryCredentials,
} from './notarize.mjs';

/**
 * notarytool stubbed at the process boundary: a fake `xcrun` executable that records its arguments and answers
 * from a script the test writes (the profile's existence, the verdict, the log). ditto runs for real.
 */
const FAKE = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const here = __dirname;
const script = JSON.parse(readFileSync(join(here, 'script.json'), 'utf8'));
const [, , tool, command, ...rest] = process.argv;
appendFileSync(join(here, 'calls.txt'), JSON.stringify([tool, command, ...rest]) + '\\n');
if (command === 'history') process.exit(script.profile ? 0 : 69);
if (command === 'submit') {
  process.stdout.write(JSON.stringify({ id: 'sub-1', status: script.status, message: 'Processing complete' }));
  process.exit(script.status === 'Accepted' ? 0 : 1);
}
if (command === 'log') { process.stdout.write(JSON.stringify(script.log)); process.exit(0); }
process.exit(2);
`;

let dir;
let xcrun;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-notarize-test-'));
  xcrun = join(dir, 'xcrun');
  await writeFile(xcrun, FAKE);
  await chmod(xcrun, 0o755);
});
after(() => rm(dir, { recursive: true, force: true }));
beforeEach(() => writeFile(join(dir, 'calls.txt'), ''));

const script = (value) => writeFile(join(dir, 'script.json'), JSON.stringify(value));
const calls = async () =>
  (await readFile(join(dir, 'calls.txt'), 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const acceptedLog = (paths) => ({
  status: 'Accepted',
  issues: null,
  ticketContents: paths.map((path) => ({ path, arch: 'arm64', cdhash: 'ab' })),
});
const PLAN = { 'whisper-cpp': { signature: 'taalcut' }, deno: { signature: { team: '2H4KBF436B' } } };

async function release() {
  const binary = join(dir, 'whisper-cli');
  await writeFile(binary, 'not really a Mach-O');
  return {
    base: 'https://components.taalcut.app',
    components: [
      {
        id: 'whisper-cpp',
        version: '1.9.5',
        url: 'https://components.taalcut.app/whisper-cpp/1.9.5/whisper-cli',
        sha256: 'a'.repeat(64),
        install: { type: 'file', fileName: 'whisper-cli', executable: true },
        machO: 1,
      },
    ],
    objects: [{ key: 'whisper-cpp/1.9.5/whisper-cli', path: binary }],
  };
}

const credentials = { profile: 'taalcut-notary' };
const options = (extra = {}) => ({ credentials, xcrun, plan: PLAN, log: () => {}, ...extra });

describe('notarytool credentials', () => {
  it('names the profile (default taalcut-notary) and the keychain, nothing else', () => {
    assert.deepEqual(notaryCredentials({}), { profile: 'taalcut-notary' });
    const ci = notaryCredentials({ TAALCUT_NOTARY_PROFILE: 'ci', TAALCUT_NOTARY_KEYCHAIN: '/k.keychain-db' });
    assert.deepEqual(credentialArgs(ci), ['--keychain-profile', 'ci', '--keychain', '/k.keychain-db']);
  });

  it('fails the run when the profile is missing, saying how to store it', async () => {
    await script({ profile: false });
    await assert.rejects(
      checkProfile(credentials, { xcrun }),
      /profile "taalcut-notary" not found.*store-credentials/,
    );
  });
});

describe('what needs notarising', () => {
  it("leaves another platform's file, built and hosted on its own kind of host, to that host (LNX1-CMP)", async () => {
    const r = await release();
    assert.equal(notarisationProblems(r, { plan: PLAN }).length, 1);
    r.components[0].elsewhere = true;
    assert.deepEqual(notarisationProblems(r, { plan: PLAN }), []);
  });
});

/** ditto is macOS's: a Linux host (LNX1) skips the submissions. */
const MAC_ONLY = process.platform !== 'darwin' && 'ditto runs on macOS only';

describe('notarizeRelease', { skip: MAC_ONLY }, () => {
  it('submits the unpacked component, reads the verdict from the JSON and records the submission', async () => {
    await script({ profile: true, status: 'Accepted', log: acceptedLog(['whisper-cpp-1.9.5/whisper-cli']) });
    const r = await release();
    await notarizeRelease(r, options());
    assert.deepEqual(r.components[0].notarisation, {
      id: 'sub-1',
      status: 'Accepted',
      tickets: 1,
      sha256: 'a'.repeat(64),
    });
    const [history, submit, log] = await calls();
    assert.deepEqual(history.slice(0, 4), ['notarytool', 'history', '--keychain-profile', 'taalcut-notary']);
    assert.equal(submit[1], 'submit');
    assert.match(submit[2], /whisper-cpp-1\.9\.5\.zip$/);
    assert.deepEqual(submit.slice(3), [
      '--keychain-profile',
      'taalcut-notary',
      '--wait',
      '--output-format',
      'json',
    ]);
    assert.deepEqual(log.slice(1, 3), ['log', 'sub-1']);
    assert.deepEqual(notarisationProblems(r, { plan: PLAN }), []);
  });

  it("fails on a rejected submission, with the log's issues", async () => {
    const log = {
      status: 'Invalid',
      issues: [
        {
          severity: 'error',
          path: 'whisper-cpp-1.9.5.zip/whisper-cpp-1.9.5/whisper-cli',
          message: 'The signature does not include a secure timestamp.',
        },
      ],
    };
    await script({ profile: true, status: 'Invalid', log });
    const r = await release();
    await assert.rejects(notarizeRelease(r, options()), /sub-1 is Invalid[\s\S]*secure timestamp/);
    assert.equal(r.components[0].notarisation, undefined);
    assert.deepEqual(notarisationProblems(r, { plan: PLAN }), [
      'whisper-cpp 1.9.5 is not notarised (run notarize.mjs)',
    ]);
  });

  it('fails an accepted submission whose log has issues or misses a Mach-O file', async () => {
    const log = { ...acceptedLog([]), issues: [{ severity: 'warning', path: 'x', message: 'odd' }] };
    await script({ profile: true, status: 'Accepted', log });
    await assert.rejects(
      notarizeRelease(await release(), options()),
      /accepted, but:\n {2}warning: x: odd\n {2}tickets for 0 files/,
    );
  });

  it('skips bytes already notarised and components it is not for', async () => {
    await script({ profile: true, status: 'Accepted', log: acceptedLog([]) });
    const r = await release();
    r.components[0].notarisation = { id: 'old', status: 'Accepted', sha256: 'a'.repeat(64), tickets: 1 };
    r.components.push({ id: 'deno', version: '2.9.6', machO: 1, sha256: 'b'.repeat(64) });
    await notarizeRelease(r, options());
    assert.deepEqual(
      (await calls()).map((call) => call[1]),
      ['history'],
    );
    assert.equal(r.components[0].notarisation.id, 'old');
  });

  it('counts a record for other bytes as no record', async () => {
    const r = await release();
    r.components[0].notarisation = { id: 'old', status: 'Accepted', sha256: 'c'.repeat(64), tickets: 1 };
    assert.equal(notarisationProblems(r, { plan: PLAN }).length, 1);
    assert.deepEqual(logProblems(acceptedLog(['a', 'b']), 2), []);
  });
});
