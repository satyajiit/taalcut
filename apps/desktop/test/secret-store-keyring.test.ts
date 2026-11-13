// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The vault on Linux (LNX1-SHL, LNX1-PKG): safeStorage encrypts with a key the session's keyring keeps (GNOME
 * Keyring or KWallet through libsecret), or, when it gets none, with a fixed one, which is as good as the clear.
 * Measured on the LNX1 host with Electron 44 (desktop SPEC, "Platform services"): isAsyncEncryptionAvailable() says
 * true in every case. Without XDG_CURRENT_DESKTOP the backend is basic_text even with an unlocked keyring on the
 * bus, hence the --password-store switch; with no keyring on the bus, or a locked one and no display to ask on,
 * it is gnome_libsecret and the values are sealed with the fixed key, and only the synchronous
 * isEncryptionAvailable() says so. So the vault asks both, and refuses unless a keyring gave the key.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok } from '@taalcut/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createVaultSecretStore,
  KeyringUnavailable,
  type SafeStorageLike,
} from '../src/main/composition/secret-store';
import { refusedSwitches } from '../src/main/security/switches';
import { darwin } from '../src/platform/darwin';
import {
  askedPasswordStore,
  KEYRING_BACKENDS,
  keyringPolicyFor,
  keyringSwitches,
  linux,
} from '../src/platform/linux';
import { win32 } from '../src/platform/win32';

const SECRET = 'sk-ant-secret-0123456789';

/**
 * safeStorage on Linux with `backend`; asynchronous encryption always "available", as Chromium reports it even with
 * the fixed key, and the synchronous encryptor available when `keyed` (a keyring gave the key).
 */
function linuxSafeStorage(backend: string | (() => string), keyed = true): SafeStorageLike {
  return {
    getSelectedStorageBackend: typeof backend === 'string' ? () => backend : backend,
    isEncryptionAvailable: () => keyed,
    isAsyncEncryptionAvailable: () => Promise.resolve(true),
    encryptStringAsync: (text) => Promise.resolve(Buffer.from(`enc:${[...text].reverse().join('')}`)),
    decryptStringAsync: (data) =>
      Promise.resolve({ shouldReEncrypt: false, result: [...data.toString().slice(4)].reverse().join('') }),
  };
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function vaultFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-keyring-'));
  dirs.push(dir);
  return join(dir, 'vault', 'secrets.json');
}

describe('the vault on Linux', () => {
  it('keeps a token when GNOME Keyring or KWallet holds the key', async () => {
    for (const backend of ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']) {
      const file = vaultFile();
      const vault = createVaultSecretStore(file, linuxSafeStorage(backend), linux.secretStore);
      expect(await vault.set('openai-codex', SECRET), backend).toEqual(ok(undefined));
      expect(readFileSync(file, 'utf8')).not.toContain(SECRET);
      expect(await vault.get('openai-codex')).toEqual(ok(SECRET));
    }
    expect([...KEYRING_BACKENDS].sort()).toEqual(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']);
  });

  it('refuses basic_text with desktop.keyring_unavailable and writes nothing', async () => {
    const file = vaultFile();
    const vault = createVaultSecretStore(file, linuxSafeStorage('basic_text'), linux.secretStore);
    const refused = await vault.set('openai-codex', SECRET);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatchObject({
      code: 'desktop.keyring_unavailable',
      messageKey: 'errors.desktop.keyring_unavailable',
      retryable: false,
      params: { operation: 'set' },
      detail: 'safeStorage backend basic_text: no system keyring',
    });
    expect(JSON.stringify(refused)).not.toContain(SECRET);
    expect(() => readFileSync(file)).toThrow();
    expect(KeyringUnavailable({ operation: 'get' }).code).toBe('desktop.keyring_unavailable');
  });

  it('refuses a keyring backend whose keyring gave no key: Chromium seals with the fixed key then', async () => {
    const file = vaultFile();
    const vault = createVaultSecretStore(file, linuxSafeStorage('gnome_libsecret', false), linux.secretStore);
    const refused = await vault.set('openai-codex', SECRET);
    expect(refused.ok ? undefined : refused.error).toMatchObject({
      code: 'desktop.keyring_unavailable',
      detail: 'safeStorage backend gnome_libsecret: the keyring gave no key',
    });
    expect(() => readFileSync(file)).toThrow();
  });

  it('refuses unknown, a backend it has never heard of and an Electron that cannot say', async () => {
    for (const safe of [
      linuxSafeStorage('unknown'),
      linuxSafeStorage('some_future_store'),
      linuxSafeStorage(() => {
        throw new Error('not supported');
      }),
      { ...linuxSafeStorage('gnome_libsecret'), getSelectedStorageBackend: undefined },
      { ...linuxSafeStorage('gnome_libsecret'), isEncryptionAvailable: undefined },
      {
        ...linuxSafeStorage('gnome_libsecret'),
        isEncryptionAvailable: () => {
          throw new Error('not supported');
        },
      },
    ]) {
      const result = await createVaultSecretStore(vaultFile(), safe, linux.secretStore).set('k', SECRET);
      expect(result.ok ? undefined : result.error.code).toBe('desktop.keyring_unavailable');
    }
  });

  it('won’t read a value back through a fixed key either, and an empty vault still answers', async () => {
    const file = vaultFile();
    await createVaultSecretStore(file, linuxSafeStorage('gnome_libsecret'), linux.secretStore).set(
      'k',
      SECRET,
    );
    const noKeyring = createVaultSecretStore(file, linuxSafeStorage('basic_text'), linux.secretStore);
    const read = await noKeyring.get('k');
    expect(read.ok ? undefined : read.error.code).toBe('desktop.keyring_unavailable');
    expect(await noKeyring.get('never-set')).toEqual(ok(undefined));
    // Deleting needs no key: a person can still sign out.
    expect(await noKeyring.delete('k')).toEqual(ok(undefined));
  });

  it('asks for the backend and the key only after encryption is available, when Chromium has picked it', async () => {
    const order: string[] = [];
    const safe: SafeStorageLike = {
      ...linuxSafeStorage('gnome_libsecret'),
      isAsyncEncryptionAvailable: async () => (order.push('available'), true),
      getSelectedStorageBackend: () => (order.push('backend'), 'gnome_libsecret'),
      isEncryptionAvailable: () => (order.push('keyed'), true),
    };
    await createVaultSecretStore(vaultFile(), safe, linux.secretStore).set('k', SECRET);
    expect(order).toEqual(['available', 'backend', 'keyed']);
  });
});

describe('the mock keyring (--password-store=basic, as --use-mock-keychain on a Mac)', () => {
  const taalcut = '/opt/Taalcut/taalcut';
  const set = (safe: SafeStorageLike, argv: readonly string[]) =>
    createVaultSecretStore(vaultFile(), safe, keyringPolicyFor(argv)).set('k', SECRET);

  it('trusts basic_text only when the command line asked for it by name', async () => {
    expect(await set(linuxSafeStorage('basic_text', false), [taalcut, '--password-store=basic'])).toEqual(
      ok(undefined),
    );
    expect(await set(linuxSafeStorage('basic_text', false), [taalcut, '--password-store=BASIC'])).toEqual(
      ok(undefined),
    );
    for (const argv of [
      [taalcut],
      [taalcut, '--password-store=gnome-libsecret'],
      // Chromium reads the last of a repeated switch.
      [taalcut, '--password-store=basic', '--password-store=gnome-libsecret'],
      [taalcut, '--password-store-basic'],
    ]) {
      const result = await set(linuxSafeStorage('basic_text', false), argv);
      expect(result.ok ? undefined : result.error.code, argv.join(' ')).toBe('desktop.keyring_unavailable');
    }
  });

  it('changes nothing for a keyring backend: one that gave no key is still refused', async () => {
    const result = await set(linuxSafeStorage('gnome_libsecret', false), [taalcut, '--password-store=basic']);
    expect(result.ok ? undefined : result.error.detail).toBe(
      'safeStorage backend gnome_libsecret: the keyring gave no key',
    );
  });

  it('reads the store asked for as the flag guard does', () => {
    expect(askedPasswordStore([taalcut])).toBeUndefined();
    expect(askedPasswordStore([taalcut, '--password-store=Basic', '--password-store=kwallet6'])).toBe(
      'kwallet6',
    );
  });
});

describe('the keyring policy on other systems', () => {
  it('never asks macOS or Windows for a backend: the keychain and DPAPI keep the key', async () => {
    const backend = vi.fn(() => 'basic_text');
    const keyed = vi.fn(() => false);
    for (const platform of [darwin, win32]) {
      const vault = createVaultSecretStore(
        vaultFile(),
        {
          ...linuxSafeStorage('basic_text'),
          getSelectedStorageBackend: backend,
          isEncryptionAvailable: keyed,
        },
        platform.secretStore,
      );
      expect(await vault.set('k', SECRET)).toEqual(ok(undefined));
    }
    expect(backend).not.toHaveBeenCalled();
    expect(keyed).not.toHaveBeenCalled();
  });
});

describe('the flag guard', () => {
  it('refuses --password-store=basic in a release build, and lets a keyring be named', () => {
    const argv = (value: string) => ['/opt/Taalcut/taalcut', `--password-store=${value}`];
    expect(refusedSwitches({ packaged: true, flavour: 'release', argv: argv('basic') })).toMatchObject([
      { name: 'password-store', value: 'basic', risk: 'keychain' },
    ]);
    expect(refusedSwitches({ packaged: true, flavour: 'release', argv: argv('gnome-libsecret') })).toEqual(
      [],
    );
    expect(refusedSwitches({ packaged: true, flavour: 'test', argv: argv('basic') })).toEqual([]);
  });
});

describe('the keyring switch', () => {
  const bus = { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' };
  const taalcut = ['/opt/Taalcut/taalcut'];

  it('names libsecret where there is a session bus and no desktop (an SSH login, a systemd unit)', () => {
    expect(keyringSwitches(bus, taalcut)).toEqual([{ name: 'password-store', value: 'gnome-libsecret' }]);
    expect(keyringSwitches({ ...bus, XDG_CURRENT_DESKTOP: ' ' }, taalcut)).toHaveLength(1);
  });

  it('leaves Chromium to choose in a desktop session, and without a bus there is no keyring to name', () => {
    expect(keyringSwitches({ ...bus, XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' }, taalcut)).toEqual([]);
    expect(keyringSwitches({ ...bus, XDG_CURRENT_DESKTOP: 'KDE' }, taalcut)).toEqual([]);
    expect(keyringSwitches({}, taalcut)).toEqual([]);
    expect(keyringSwitches({ DBUS_SESSION_BUS_ADDRESS: '' }, taalcut)).toEqual([]);
  });

  it('never overrides a --password-store given on the command line', () => {
    for (const given of ['--password-store=kwallet6', '--password-store=basic', '--password-store'])
      expect(keyringSwitches(bus, [...taalcut, given]), given).toEqual([]);
    expect(keyringSwitches(bus, [...taalcut, '--password-store-extra=1'])).toHaveLength(1);
  });

  it('is what the Linux module hands main, from the environment it starts in', () => {
    expect(linux.electronSwitches).toEqual(keyringSwitches(process.env, process.argv));
    expect(darwin.electronSwitches).toEqual([]);
    expect(win32.electronSwitches).toEqual([]);
  });
});
