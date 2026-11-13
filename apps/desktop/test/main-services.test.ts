// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What main keeps for the other processes: the keychain vault (never a value
 * in the clear, never one in an error), the credentials the agent asks for,
 * the recovery offer, and the agent's local runtime slot.
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  connectRpc,
  credentialsContract,
  err,
  newId,
  NotFoundError,
  ok,
  recoveryContract,
  serveRpc,
  type AnyContractRouter,
  type RecoveryReport,
  type RpcRouter,
} from '@taalcut/core';
import { assessHardware, createModelRuntime } from '@taalcut/models';
import { credentialsRouter, recoveryRouter } from '../src/main/composition/main-routers';
import { createRecoveryState } from '../src/main/composition/run-recovery';
import {
  createVaultSecretStore as createVault,
  type SafeStorageLike,
} from '../src/main/composition/secret-store';
import { darwin } from '../src/platform/darwin';
import { createLocalRuntimeSlot, NO_INSTALLER } from '../src/utility/roots/local-runtime';
import { M3_INFO } from './helpers/roots';

const SECRET = 'sk-ant-secret-0123456789';

/** The vault as macOS has it: the keychain keeps the key (secret-store-keyring.test.ts has Linux's policy). */
const createVaultSecretStore = (file: string, safe: SafeStorageLike) =>
  createVault(file, safe, darwin.secretStore);

type FakeSafeStorage = SafeStorageLike & { available: boolean; newerKey: boolean };

/** Reversible stand-in for the keychain: a different string, never the value itself. */
function fakeSafeStorage(available = true): FakeSafeStorage {
  const safe: FakeSafeStorage = {
    available,
    newerKey: false,
    isAsyncEncryptionAvailable: () => Promise.resolve(safe.available),
    encryptStringAsync: (text) =>
      Promise.resolve(Buffer.from(`${safe.newerKey ? 'enc2' : 'enc'}:${[...text].reverse().join('')}`)),
    decryptStringAsync: (data) => {
      const [prefix, ...rest] = data.toString().split(':');
      if (prefix !== 'enc' && prefix !== 'enc2') return Promise.reject(new Error(`cannot decrypt ${data}`));
      const result = [...rest.join(':')].reverse().join('');
      return Promise.resolve({ shouldReEncrypt: safe.newerKey && prefix === 'enc', result });
    },
  };
  return safe;
}

/** Waits for a call whose answer the test gives later, as macOS does while it asks the person. */
function heldCalls<T>() {
  const waiting: ((value: T) => void)[] = [];
  return {
    call: () => new Promise<T>((resolve) => waiting.push(resolve)),
    get count() {
      return waiting.length;
    },
    answer: (index: number, value: T) => waiting[index]?.(value),
  };
}

const dirs: string[] = [];
const ports: MessageChannel[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const { port1, port2 } of ports.splice(0)) {
    port1.close();
    port2.close();
  }
});

function vaultFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-vault-'));
  dirs.push(dir);
  return join(dir, 'vault', 'secrets.json');
}

function serve<C extends AnyContractRouter>(contract: C, router: RpcRouter<C, Record<never, never>>) {
  const channel = new MessageChannel();
  ports.push(channel);
  serveRpc(router, channel.port1, { context: {} });
  return connectRpc(contract, channel.port2, { peer: 'main' }).client;
}

describe('keychain vault', () => {
  it('keeps values encrypted in a 0600 file and reads them back after a restart', async () => {
    const file = vaultFile();
    const safe = fakeSafeStorage();
    const vault = createVaultSecretStore(file, safe);
    expect(await vault.get('anthropic')).toEqual(ok(undefined));
    expect(await vault.set('anthropic', SECRET)).toEqual(ok(undefined));
    expect(readFileSync(file, 'utf8')).not.toContain(SECRET);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(await createVaultSecretStore(file, safe).get('anthropic')).toEqual(ok(SECRET));
    expect(await vault.delete('anthropic')).toEqual(ok(undefined));
    expect(await createVaultSecretStore(file, safe).get('anthropic')).toEqual(ok(undefined));
  });

  it('refuses rather than writing in the clear, and never quotes what it could not decrypt', async () => {
    const file = vaultFile();
    const safe = fakeSafeStorage(false);
    const vault = createVaultSecretStore(file, safe);
    const refused = await vault.set('anthropic', SECRET);
    expect(refused.ok ? undefined : refused.error.code).toBe('models.secret_store_failed');
    expect(() => readFileSync(file)).toThrow();

    safe.available = true;
    await vault.set('anthropic', SECRET);
    const broken = createVaultSecretStore(file, {
      ...fakeSafeStorage(),
      decryptStringAsync: () => Promise.reject(new Error(`bad ${SECRET}`)),
    });
    const failed = await broken.get('anthropic');
    expect(failed.ok).toBe(false);
    expect(JSON.stringify(failed)).not.toContain(SECRET);

    // The keychain refusing outright (no keychain, the person declined) is encryption unavailable.
    const declined = createVaultSecretStore(file, {
      ...fakeSafeStorage(),
      isAsyncEncryptionAvailable: () => Promise.reject(new Error('no keychain')),
    });
    const unavailable = await declined.get('anthropic');
    expect(unavailable.ok ? undefined : unavailable.error.detail).toBe('encryption unavailable');
  });

  it('while the keychain is asking, later calls wait and apply in the order they were made', async () => {
    const file = vaultFile();
    const encryptions = heldCalls<Buffer>();
    const vault = createVaultSecretStore(file, {
      ...fakeSafeStorage(),
      encryptStringAsync: encryptions.call,
    });
    const first = vault.set('anthropic', 'first');
    const second = vault.set('anthropic', 'second');
    const read = vault.get('anthropic');
    // macOS is asking about the first: the second hasn't reached the keychain, and nothing is written yet.
    await vi.waitFor(() => expect(encryptions.count).toBe(1));
    expect(() => readFileSync(file)).toThrow();
    encryptions.answer(0, Buffer.from('enc:tsrif'));
    expect(await first).toEqual(ok(undefined));
    await vi.waitFor(() => expect(encryptions.count).toBe(2));
    encryptions.answer(1, Buffer.from('enc:dnoces'));
    expect(await second).toEqual(ok(undefined));
    expect(await read).toEqual(ok('second'));
  });

  it('re-encrypts a value under a newer key when safeStorage asks, and still reads it', async () => {
    const file = vaultFile();
    const safe = fakeSafeStorage();
    await createVaultSecretStore(file, safe).set('anthropic', SECRET);
    safe.newerKey = true;
    expect(await createVaultSecretStore(file, safe).get('anthropic')).toEqual(ok(SECRET));
    const underNewerKey = Buffer.from(`enc2:${[...SECRET].reverse().join('')}`).toString('base64');
    expect(readFileSync(file, 'utf8')).toContain(underNewerKey);
    expect(await createVaultSecretStore(file, safe).get('anthropic')).toEqual(ok(SECRET));
  });
});

describe('credentials for the agent', () => {
  it('gives one credential per request, passes invalidations on, and says which are set up', async () => {
    const get = vi.fn(async (provider: string) =>
      provider === 'anthropic'
        ? ok({ kind: 'api_key' as const, secret: SECRET, source: 'stored credential' })
        : provider === 'broken'
          ? err(NotFoundError({ entity: 'provider', id: provider }))
          : ok(undefined),
    );
    const invalidate = vi.fn();
    const statuses = async () =>
      ok([
        { provider: 'anthropic', signedIn: true, method: 'api_key' as const, planLabelKey: 'k' },
        { provider: 'openai', signedIn: true, method: 'subscription' as const, planLabelKey: 'k' },
        { provider: 'xai', signedIn: false, planLabelKey: 'k' },
      ]);
    const client = serve(credentialsContract, credentialsRouter({ get, invalidate, statuses }));
    expect(await client.get({ provider: 'anthropic', minValidityMs: 60_000 })).toEqual({
      kind: 'api_key',
      secret: SECRET,
      source: 'stored credential',
    });
    expect(get).toHaveBeenCalledWith('anthropic', expect.objectContaining({ minValidityMs: 60_000 }));
    expect(await client.get({ provider: 'xai' })).toBeNull();
    await expect(client.get({ provider: 'broken' })).rejects.toMatchObject({
      data: { code: 'core.not_found' },
    });
    await client.invalidate({ provider: 'anthropic' });
    expect(invalidate).toHaveBeenCalledWith('anthropic');
    // Which providers are set up (ids only); the ChatGPT plan is 'openai-codex' to the model picker.
    expect(await client.configured()).toEqual(['anthropic', 'openai', 'openai-codex']);
  });
});

describe('recovery offer', () => {
  const report = (): RecoveryReport => ({
    restoredFromBackup: null,
    needsAttention: true,
    unfinishedRuns: [
      {
        runId: newId<'AgentRun'>(),
        conversationId: null,
        status: 'running',
        lastSeq: 3,
        startedAt: 1,
        updatedAt: 2,
      },
    ],
    reclaimedJobs: [],
    lastCommands: [],
  });

  const offer = (initial: RecoveryReport) =>
    createRecoveryState({
      initial,
      read: () => ok({ unfinishedRuns: [], lastCommands: [] }),
      events: { emit() {} },
    });

  it('is offered once: resuming hands the runs to the agent, and dismissing ends it', async () => {
    const resume = vi.fn(async () => undefined);
    const offered = report();
    const client = serve(recoveryContract, recoveryRouter({ state: offer(offered), resume }));
    expect((await client.report()).needsAttention).toBe(true);
    const runIds = offered.unfinishedRuns.map((run) => run.runId);
    await client.resumeRuns({ runIds });
    expect(resume).toHaveBeenCalledWith(runIds);
    expect((await client.report()).needsAttention).toBe(false);

    const second = serve(recoveryContract, recoveryRouter({ state: offer(report()), resume }));
    await second.dismiss();
    expect((await second.report()).needsAttention).toBe(false);
  });
});

describe('local runtime slot', () => {
  const hardware = assessHardware(M3_INFO);

  it('leaves calls alone before start and for cloud providers', async () => {
    const slot = createLocalRuntimeSlot({ runtime: createModelRuntime(), installer: NO_INSTALLER });
    expect(await slot.localLease('on-device')).toEqual(ok(undefined));
    expect(await slot.stopForExport()).toEqual(ok(undefined));
    expect(await slot.resumeAfterExport()).toEqual(ok(undefined));
    await slot.dispose();
  });

  it('fails an on-device call it cannot install for, and refuses while an export holds the GPU', async () => {
    const install = vi.fn(async () => err(NotFoundError({ entity: 'component', id: 'llama-server' })));
    const slot = createLocalRuntimeSlot({
      runtime: createModelRuntime(),
      installer: { install, get: async () => undefined },
      log: () => undefined,
    });
    slot.start(hardware);
    expect(await slot.localLease('anthropic')).toEqual(ok(undefined));
    expect((await slot.localLease('on-device')).ok).toBe(false);
    expect(await slot.stopForExport()).toMatchObject({ ok: true });
    const paused = await slot.localLease('on-device');
    expect(paused.ok ? undefined : paused.error.code).toBe('models.local_runtime_unavailable');
    expect(await slot.resumeAfterExport()).toEqual(ok(undefined));
    await slot.dispose();
  });
});
