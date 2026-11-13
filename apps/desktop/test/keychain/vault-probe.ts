// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The keychain vault in Electron, against a real keychain. scripts/keychain-vault.mjs bundles this as an
 * Electron main and runs it under a temporary HOME whose default keychain is a throwaway one; never with
 * --use-mock-keychain. Each phase is its own process (so safeStorage's key is fetched from the keychain again), and
 * each step is one JSON line on stdout. A 50 ms timer measures main's event loop the whole time: `maxGapMs` is the
 * longest it went without a tick.
 *
 *   write       the synchronous API writes a value the way the vault before UX2 round 4 stored it; the vault (the
 *               async API) writes another; each API reads the other's, and the vault reads its own back
 *   read        a new process: the vault and the synchronous API read both again
 *   reencrypt   the vault re-encrypts a value when decryptStringAsync asks it to (forced once here: see below)
 *   locked      the vault reads while the runner holds the keychain locked; it answers once the keychain prompt
 *               is answered, and main keeps ticking while it waits
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { app, safeStorage } from 'electron';
import {
  createVaultSecretStore as createVault,
  type SafeStorageLike,
} from '../../src/main/composition/secret-store';
import { darwin } from '../../src/platform/darwin';

/** macOS only: the keychain keeps the key. */
const createVaultSecretStore = (file: string, safe: SafeStorageLike) =>
  createVault(file, safe, darwin.secretStore);

const ASYNC_VALUE = 'written by the vault, through the async API · ✓ ü';
const SYNC_VALUE = 'written by the synchronous safeStorage API';
const EXPECTED: Record<string, string> = { async: ASYNC_VALUE, sync: SYNC_VALUE };

const option = (name: string): string => {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (!found) throw new Error(`vault-probe needs ${prefix}`);
  return found.slice(prefix.length);
};

let last = Date.now();
let maxGapMs = 0;
setInterval(() => {
  const now = Date.now();
  maxGapMs = Math.max(maxGapMs, now - last);
  last = now;
}, 50);

const emit = (step: string, facts: Record<string, unknown> = {}): void => {
  process.stdout.write(`${JSON.stringify({ step, maxGapMs, ...facts })}\n`);
};

const stored = (file: string): Record<string, string> =>
  JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;

/** Whether the async and sync APIs read a stored (base64) value as written, and whether async asked to re-encrypt. */
async function readBoth(file: string, key: string) {
  const data = Buffer.from(stored(file)[key] ?? '', 'base64');
  const viaAsync = await safeStorage.decryptStringAsync(data);
  return {
    asyncReads: viaAsync.result === EXPECTED[key],
    syncReads: safeStorage.decryptString(data) === EXPECTED[key],
    shouldReEncrypt: viaAsync.shouldReEncrypt,
  };
}

/** Whether the vault reads the value as written (never the value itself, nor an error's detail). */
async function valueOf(vault: ReturnType<typeof createVaultSecretStore>, key: string) {
  const got = await vault.get(key);
  return got.ok ? { ok: true, reads: got.value === EXPECTED[key] } : { ok: false, error: got.error.code };
}

async function write(file: string): Promise<void> {
  emit('available', {
    async: await safeStorage.isAsyncEncryptionAvailable(),
    sync: safeStorage.isEncryptionAvailable(),
  });
  // The pre-round-4 vault's form: base64 of encryptString, one entry per key, in a 0600 JSON file.
  writeFileSync(file, JSON.stringify({ sync: safeStorage.encryptString(SYNC_VALUE).toString('base64') }), {
    mode: 0o600,
  });
  const vault = createVaultSecretStore(file, safeStorage);
  const set = await vault.set('async', ASYNC_VALUE);
  emit('set', { ok: set.ok });
  emit('vault reads its own', await valueOf(vault, 'async'));
  emit('vault reads the sync API’s', await valueOf(vault, 'sync'));
  emit('both APIs read the vault’s', await readBoth(file, 'async'));
  emit('both APIs read the sync API’s', await readBoth(file, 'sync'));
}

async function read(file: string): Promise<void> {
  const vault = createVaultSecretStore(file, safeStorage);
  emit('vault reads its own', await valueOf(vault, 'async'));
  emit('vault reads the sync API’s', await valueOf(vault, 'sync'));
  emit('both APIs read the vault’s', await readBoth(file, 'async'));
  emit('both APIs read the sync API’s', await readBoth(file, 'sync'));
}

/**
 * On macOS safeStorage has one key, the keychain's, so decryptStringAsync never asks to re-encrypt (write and read
 * report shouldReEncrypt as it comes). To run the vault's re-encryption against the real keychain, the first
 * answer here says yes; everything else is the real API.
 */
async function reencrypt(file: string): Promise<void> {
  let encrypts = 0;
  let asked = false;
  const asking: SafeStorageLike = {
    isAsyncEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
    encryptStringAsync: (text) => {
      encrypts += 1;
      return safeStorage.encryptStringAsync(text);
    },
    decryptStringAsync: async (data) => {
      const real = await safeStorage.decryptStringAsync(data);
      if (asked) return real;
      asked = true;
      return { ...real, shouldReEncrypt: true };
    },
  };
  const before = stored(file)['sync'];
  const vault = createVaultSecretStore(file, asking);
  emit('vault reads, asked to re-encrypt', await valueOf(vault, 'sync'));
  emit('re-encrypted', {
    encrypts,
    sameBytes: stored(file)['sync'] === before,
    ...(await readBoth(file, 'sync')),
  });
}

async function locked(file: string): Promise<void> {
  const vault = createVaultSecretStore(file, safeStorage);
  const started = Date.now();
  const ticking = setInterval(() => emit('waiting', { forMs: Date.now() - started }), 500);
  emit('asking');
  const got = await valueOf(vault, 'async');
  clearInterval(ticking);
  emit('answered', { ...got, afterMs: Date.now() - started });
}

const PHASES: Record<string, (file: string) => Promise<void>> = { write, read, reencrypt, locked };

// No Dock icon and no activation: the probe has no window, and must not take focus from whoever is working.
app.dock?.hide();
app.setName('TaalcutVaultProof');
void app.whenReady().then(async () => {
  // Measured from here: Electron's own start-up is not the vault's doing.
  last = Date.now();
  maxGapMs = 0;
  try {
    const phase = PHASES[option('phase')];
    if (!phase) throw new Error(`unknown phase ${option('phase')}`);
    await phase(option('vault'));
    emit('done');
    app.exit(0);
  } catch (error) {
    emit('failed', { message: error instanceof Error ? error.message : String(error) });
    app.exit(1);
  }
});
