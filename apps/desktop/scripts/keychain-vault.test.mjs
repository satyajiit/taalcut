// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The keychain vault against a throwaway real keychain (keychain-vault.mjs), unattended: the round trip, the async
 * and sync APIs reading each other's values within a process and from a new one, re-encryption, and the person's
 * keychain settings untouched. No prompt is shown. The locked-keychain phase puts one on screen, so it runs only by
 * hand: node apps/desktop/scripts/keychain-vault.mjs --locked.
 *
 *   node --test apps/desktop/scripts/keychain-vault.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proveVault } from './keychain-vault.mjs';

test(
  'the vault against a throwaway real keychain: round trip, both APIs, a new process, re-encryption',
  { skip: process.platform !== 'darwin' && 'macOS keychains only', timeout: 180_000 },
  async () => {
    const { checks, facts } = await proveVault();
    const failed = checks.filter((check) => !check.ok);
    assert.deepEqual(failed, [], failed.map((check) => `${check.name}: ${check.why}`).join('\n'));
    assert.ok(checks.length >= 20, `${checks.length} checks ran`);
    // macOS safeStorage has one key, so neither API's values ask to be re-encrypted.
    assert.deepEqual(facts.shouldReEncrypt, { vaults: false, syncApis: false });
  },
);
