// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  isMachOHeader,
  machOFiles,
  parseEntitlementKeys,
  parseSignature,
  signatureProblem,
  signingOrder,
  treeProblems,
} from './codesign.mjs';

const dirs = [];
after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

const header = (...words) => Buffer.concat(words.map((word) => Buffer.from(word, 'hex')));

describe('isMachOHeader', () => {
  it('knows thin and universal Mach-O', () => {
    assert.equal(isMachOHeader(header('cffaedfe', '0c000001')), true);
    assert.equal(isMachOHeader(header('feedfacf', '0100000c')), true);
    assert.equal(isMachOHeader(header('cafebabe', '00000002')), true);
  });

  it('is not fooled by a Java class file, text or a short file', () => {
    assert.equal(isMachOHeader(header('cafebabe', '00000041')), false);
    assert.equal(isMachOHeader(Buffer.from('#!/bin/sh\n')), false);
    assert.equal(isMachOHeader(header('cffaedfe')), false);
  });
});

/** codesign is macOS's: a Linux host (LNX1) skips what runs it. */
const MAC_ONLY = process.platform !== 'darwin' && 'codesign runs on macOS only';

describe('signing', () => {
  it('signs libraries before the programs that load them', () => {
    assert.deepEqual(signingOrder(['llama-server', 'libllama.0.dylib', 'binding.node', 'tool']), [
      'libllama.0.dylib',
      'binding.node',
      'llama-server',
      'tool',
    ]);
  });

  it('reads the entitlement keys from codesign --entitlements --xml', () => {
    const xml =
      '<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/>' +
      '<key>com.apple.security.cs.allow-dyld-environment-variables</key><true/></dict></plist>';
    assert.deepEqual(parseEntitlementKeys(xml), [
      'com.apple.security.cs.allow-dyld-environment-variables',
      'com.apple.security.cs.allow-jit',
    ]);
    assert.deepEqual(parseEntitlementKeys(''), []);
  });

  it('reads the policy fields from codesign -dvv', () => {
    const developerId = parseSignature(
      [
        'CodeDirectory v=20500 size=71961 flags=0x10000(runtime) hashes=2243+2 location=embedded',
        'Authority=Developer ID Application: Matterward Labs Private Limited (WW382UC8JD)',
        'Authority=Developer ID Certification Authority',
        'Timestamp=24 Oct 2026 at 8:39:32 AM',
        'TeamIdentifier=WW382UC8JD',
      ].join('\n'),
    );
    assert.deepEqual(developerId, {
      authority: 'Developer ID Application: Matterward Labs Private Limited (WW382UC8JD)',
      team: 'WW382UC8JD',
      timestamp: '24 Oct 2026 at 8:39:32 AM',
      runtime: true,
      adhoc: false,
    });
    const adhoc = parseSignature(
      'flags=0x20002(adhoc,linker-signed)\nSignature=adhoc\nTeamIdentifier=not set',
    );
    assert.equal(adhoc.adhoc, true);
    assert.equal(adhoc.runtime, false);
  });

  it(
    "refuses a binary that isn't Taalcut's Developer ID, and counts only Mach-O files",
    { skip: MAC_ONLY },
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'taalcut-codesign-test-'));
      dirs.push(dir);
      await copyFile('/usr/bin/true', join(dir, 'true'));
      await writeFile(join(dir, 'README'), 'not a binary\n');
      assert.match(await signatureProblem(join(dir, 'true'), 'WW382UC8JD'), /not a Developer ID Application/);
      assert.deepEqual(await machOFiles(dir, ['README', 'true']), ['true']);
      const { count, problems } = await treeProblems(dir, ['README', 'true'], 'WW382UC8JD');
      assert.equal(count, 1);
      assert.equal(problems.length, 1);
    },
  );
});
