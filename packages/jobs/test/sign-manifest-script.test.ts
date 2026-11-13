// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * tools/components/sign-manifest.mjs, run as a child process with ephemeral
 * keys: what it signs, the app's verifier accepts (two implementations of
 * the canonical form, checked against each other). The keychain is never
 * touched: TAALCUT_SECURITY_BIN points at a missing file, or at a fake
 * `security` for --generate.
 */
import { spawnSync } from 'node:child_process';
import { createPublicKey, createPrivateKey } from 'node:crypto';
import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseManifest, verifySignedManifest, type TrustedKey } from '@taalcut/jobs';
import { tempDir } from './helpers/fixtures';
import { newKey, trustedKeyFor } from './helpers/signing';

const tools = new URL('../../../tools/components/', import.meta.url);
const script = fileURLToPath(new URL('sign-manifest.mjs', tools));
const provisional = fileURLToPath(new URL('manifest.local-llm.provisional.json', tools));
const committedFile = fileURLToPath(new URL('./fixtures/development-manifest-key.ts', import.meta.url));

let dir: string;
beforeEach(async () => {
  dir = await tempDir();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function run(args: string[], env: Record<string, string> = {}) {
  const {
    TAALCUT_MANIFEST_KEY_FILE: _file,
    TAALCUT_MANIFEST_KEYCHAIN_SERVICE: _service,
    TAALCUT_SECURITY_BIN: _bin,
    ...inherited
  } = process.env;
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...inherited, TAALCUT_SECURITY_BIN: join(dir, 'no-security-here'), ...env },
  });
}

async function keyFile(name: string, format: 'pem' | 'der') {
  const key = newKey();
  const path = join(dir, name);
  const text =
    format === 'pem'
      ? key.export({ format: 'pem', type: 'pkcs8' }).toString()
      : key.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  await writeFile(path, text);
  return { key, path };
}

const verify = async (path: string, trustedKeys: TrustedKey[]) =>
  verifySignedManifest(JSON.parse(await readFile(path, 'utf8')), {
    trustedKeys,
    release: true,
    now: Date.now(),
  });

describe('sign-manifest.mjs', () => {
  it('signs a manifest that the app accepts', async () => {
    const { key, path } = await keyFile('key.pem', 'pem');
    const out = join(dir, 'signed.json');
    const result = run([provisional, '--out', out, '--sequence', '3', '--valid-days', '30'], {
      TAALCUT_MANIFEST_KEY_FILE: path,
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const verified = await verify(out, [trustedKeyFor(key)]);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.sequence).toBe(3);
    const days = (Date.parse(verified.value.notAfter) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
    const source = parseManifest(JSON.parse(await readFile(provisional, 'utf8')));
    expect(verified.value.manifest.components).toEqual(source.ok && source.value.components);
    expect(JSON.parse(await readFile(out, 'utf8')).manifest).not.toHaveProperty('$schema');
  });

  it('adds the next key beside the current one for a rotation, leaving the payload alone', async () => {
    const first = await keyFile('current.pem', 'pem');
    const second = await keyFile('next.der.b64', 'der');
    const once = join(dir, 'once.json');
    const twice = join(dir, 'twice.json');
    run([provisional, '--out', once, '--sequence', '4'], { TAALCUT_MANIFEST_KEY_FILE: first.path });
    expect(run([once, '--out', twice], { TAALCUT_MANIFEST_KEY_FILE: second.path }).status).toBe(0);
    expect(run([twice, '--out', twice], { TAALCUT_MANIFEST_KEY_FILE: second.path }).status).toBe(0);
    const [a, b] = [JSON.parse(await readFile(once, 'utf8')), JSON.parse(await readFile(twice, 'utf8'))];
    expect(b.manifest).toEqual(a.manifest);
    expect(b.signatures.map((s: { keyId: string }) => s.keyId)).toEqual([
      trustedKeyFor(first.key).keyId,
      trustedKeyFor(second.key).keyId,
    ]);
    expect((await verify(twice, [trustedKeyFor(second.key)])).ok).toBe(true);
    expect((await verify(twice, [trustedKeyFor(first.key)])).ok).toBe(true);
  });

  it('refuses a key file inside the repository, and a manifest without a sequence', async () => {
    const out = join(dir, 'signed.json');
    const inRepo = run([provisional, '--out', out, '--sequence', '1'], {
      TAALCUT_MANIFEST_KEY_FILE: committedFile,
    });
    expect(inRepo.status).toBe(1);
    expect(inRepo.stderr).toMatch(/never live inside the repository/);
    const { path } = await keyFile('key.pem', 'pem');
    const noSequence = run([provisional, '--out', out], { TAALCUT_MANIFEST_KEY_FILE: path });
    expect(noSequence.status).toBe(1);
    expect(noSequence.stderr).toMatch(/sequence is required/);
    await expect(readFile(out)).rejects.toThrow();
  });

  // The keychain's three cases are three tests, each starting at most three processes (node, and the fake
  // `security` once or twice): one test doing all three in a row started seven, and on a busy machine (each
  // start taking seconds) ran past its limit (UX2 round 2, the hosting lane's pnpm check: 20 s; 1 s alone).
  async function fakeKeychain(stored?: string) {
    const security = join(dir, 'security');
    await writeFile(security, FAKE_SECURITY);
    await chmod(security, 0o755);
    if (stored !== undefined) await writeFile(join(dir, 'secret'), `${stored}\n`);
    return { TAALCUT_SECURITY_BIN: security, FAKE_DIR: dir };
  }
  const derBase64 = (key: ReturnType<typeof newKey>) =>
    key.export({ format: 'der', type: 'pkcs8' }).toString('base64');

  it('--generate stores the private key through stdin, never argv', async () => {
    const env = await fakeKeychain();
    const generated = run(['--generate'], env);
    expect(generated.stderr).toBe('');
    expect(generated.status).toBe(0);
    const printed = /keyId: '([0-9a-f]{16})', publicKey: '([\w-]+)'/.exec(generated.stdout);
    expect(printed, generated.stdout).not.toBeNull();
    const publicKey = printed?.[2];
    const secret = (await readFile(join(dir, 'secret'), 'utf8')).trim();
    const stored = createPrivateKey({ key: Buffer.from(secret, 'base64'), format: 'der', type: 'pkcs8' });
    expect(createPublicKey(stored).export({ format: 'jwk' }).x).toBe(publicKey);
    expect(await readFile(join(dir, 'argv.log'), 'utf8')).not.toContain(secret);
  });

  it('signs with the keychain’s key when there is no key file', async () => {
    const key = newKey();
    const env = await fakeKeychain(derBase64(key));
    const out = join(dir, 'signed.json');
    expect(run([provisional, '--out', out, '--sequence', '1'], env).status).toBe(0);
    expect((await verify(out, [trustedKeyFor(key)])).ok).toBe(true);
  });

  it('--generate never overwrites a stored key', async () => {
    const secret = derBase64(newKey());
    const env = await fakeKeychain(secret);
    const again = run(['--generate'], env);
    expect(again.status).toBe(1);
    expect(again.stderr).toMatch(/already holds a key/);
    expect((await readFile(join(dir, 'secret'), 'utf8')).trim()).toBe(secret);
  });
});

/** A stand-in for macOS `security` holding one generic password in $FAKE_DIR/secret. */
const FAKE_SECURITY = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_DIR/argv.log"
if [ "$1" = "find-generic-password" ]; then
  [ -f "$FAKE_DIR/secret" ] || exit 44
  cat "$FAKE_DIR/secret"
  exit 0
fi
if [ "$1" = "-i" ]; then
  while read -r line; do
    set -- $line
    while [ $# -gt 0 ]; do
      if [ "$1" = "-w" ]; then printf '%s\\n' "$2" > "$FAKE_DIR/secret"; fi
      shift
    done
  done
  exit 0
fi
exit 1
`;
