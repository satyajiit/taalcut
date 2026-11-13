#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Signs a component manifest with Ed25519 (Node built-ins only) for the
 * app's loader (packages/jobs, src/components/signing). See README.md,
 * "Releasing components".
 *
 *   node tools/components/sign-manifest.mjs <manifest.json> --out <signed.json>
 *        [--sequence N] [--valid-days N | --not-after 2027-04-01T00:00:00Z]
 *   node tools/components/sign-manifest.mjs --generate
 *
 * The private key comes from the file named by TAALCUT_MANIFEST_KEY_FILE
 * (PKCS#8, PEM or base64 DER), or else from the macOS keychain
 * (`security find-generic-password -s taalcut-manifest-key -w`). Never from
 * inside this repository: a key file there is refused.
 *
 * A plain manifest gets `sequence` (from --sequence or its own field) and
 * `notAfter` (default: 180 days from now), and the output is
 * `{ manifest, signatures: [{ keyId, sig }] }`. Signing an already signed file
 * adds (or replaces) this key's signature and leaves the payload alone: that
 * is how a manifest carries both the current and the next key during a
 * rotation.
 *
 * --generate makes a key pair, stores the private half in the keychain (sent
 * to `security` on stdin, never in argv; an existing key is never
 * overwritten) and prints the public half for
 * packages/jobs/src/components/trusted-keys.ts. The owner runs it once.
 *
 * Environment: TAALCUT_MANIFEST_KEY_FILE; TAALCUT_MANIFEST_KEYCHAIN_SERVICE
 * (default taalcut-manifest-key); TAALCUT_SECURITY_BIN (default
 * /usr/bin/security; tests point it at a fake).
 */
import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** Must equal SIGNATURE_CONTEXT in packages/jobs/src/components/signing/canonical.ts. */
const CONTEXT = 'taalcut-component-manifest/v1\n';
const REPO = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const SERVICE = process.env.TAALCUT_MANIFEST_KEYCHAIN_SERVICE || 'taalcut-manifest-key';
const SECURITY = process.env.TAALCUT_SECURITY_BIN || '/usr/bin/security';
const DAY_MS = 24 * 60 * 60 * 1000;

const USAGE = `Usage:
  node tools/components/sign-manifest.mjs <manifest.json> --out <signed.json>
       [--sequence N] [--valid-days N | --not-after <ISO time ending in Z>]
  node tools/components/sign-manifest.mjs --generate`;

function fail(message) {
  console.error(`sign-manifest: ${message}`);
  process.exit(1);
}

/** Same rules as canonicalJson in packages/jobs/src/components/signing/canonical.ts. */
function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('not a JSON number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const members = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${members.join(',')}}`;
  }
  throw new TypeError(`not a JSON value: ${typeof value}`);
}

function publicHalf(privateKey) {
  const x = createPublicKey(privateKey).export({ format: 'jwk' }).x;
  const keyId = createHash('sha256').update(Buffer.from(x, 'base64url')).digest('hex').slice(0, 16);
  return { keyId, publicKey: x };
}

function parsePrivateKey(text) {
  const key = text.includes('-----BEGIN')
    ? createPrivateKey(text)
    : createPrivateKey({ key: Buffer.from(text.trim(), 'base64'), format: 'der', type: 'pkcs8' });
  if (key.asymmetricKeyType !== 'ed25519') fail(`the key is ${key.asymmetricKeyType}, not ed25519`);
  return key;
}

/** The keychain item's secret, or undefined when there is none. */
function readKeychain() {
  try {
    const out = execFileSync(SECURITY, ['find-generic-password', '-s', SERVICE, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() || undefined;
  } catch {
    return undefined;
  }
}

function loadPrivateKey() {
  const file = process.env.TAALCUT_MANIFEST_KEY_FILE;
  if (file) {
    const real = realpathSync(file);
    const rel = relative(REPO, real);
    if (rel === '' || (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel))) {
      fail(`refusing ${rel}: signing keys never live inside the repository`);
    }
    return parsePrivateKey(readFileSync(real, 'utf8'));
  }
  const secret = readKeychain();
  if (!secret) fail(`no key: set TAALCUT_MANIFEST_KEY_FILE, or store one in the keychain as '${SERVICE}'`);
  return parsePrivateKey(secret);
}

function notAfterFrom(values) {
  if (values['not-after'] !== undefined && values['valid-days'] !== undefined) {
    fail('give --not-after or --valid-days, not both');
  }
  let time;
  if (values['not-after'] !== undefined) {
    if (!/Z$/.test(values['not-after'])) fail('--not-after must be UTC, ending in Z');
    time = Date.parse(values['not-after']);
  } else {
    const days = Number(values['valid-days'] ?? 180);
    if (!Number.isInteger(days) || days < 1) fail('--valid-days must be a whole number of days');
    time = Date.now() + days * DAY_MS;
  }
  if (!Number.isFinite(time) || time <= Date.now()) fail('notAfter must be a valid time in the future');
  return new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function signFile(inputPath, values) {
  if (!values.out) fail(`--out is required\n${USAGE}`);
  const input = JSON.parse(readFileSync(inputPath, 'utf8'));
  const alreadySigned = 'manifest' in input && 'signatures' in input;
  let manifest;
  let signatures = [];
  if (alreadySigned) {
    if (values.sequence || values['valid-days'] || values['not-after']) {
      fail('the file is already signed: its payload, sequence and notAfter stay as they are');
    }
    ({ manifest, signatures } = input);
  } else {
    // $schema points into this repo and $comment is for editors: neither ships.
    const { $schema: _schema, $comment: _comment, ...rest } = input;
    const sequence = Number(values.sequence ?? rest.sequence);
    manifest = { ...rest, sequence, notAfter: notAfterFrom(values) };
  }
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.components)) {
    fail('not a component manifest (schemaVersion 1 with components)');
  }
  if (!Number.isSafeInteger(manifest.sequence) || manifest.sequence < 1) {
    fail('a positive whole sequence is required (--sequence N, higher than the last published one)');
  }
  const key = loadPrivateKey();
  const { keyId } = publicHalf(key);
  const sig = sign(null, Buffer.from(CONTEXT + canonicalJson(manifest), 'utf8'), key).toString('base64');
  const output = { manifest, signatures: [...signatures.filter((s) => s.keyId !== keyId), { keyId, sig }] };
  writeFileSync(values.out, `${JSON.stringify(output, null, 2)}\n`);
  console.log(
    `Signed ${inputPath} -> ${values.out}: sequence ${manifest.sequence}, notAfter ${manifest.notAfter}, ` +
      `key ${keyId} (${output.signatures.length} signature${output.signatures.length === 1 ? '' : 's'}).`,
  );
}

function generate() {
  if (!/^[A-Za-z0-9._-]+$/.test(SERVICE)) fail(`unusable keychain service name '${SERVICE}'`);
  if (readKeychain() !== undefined) {
    fail(
      `the keychain already holds a key as '${SERVICE}'. It is not replaced. Delete it first only if you ` +
        `mean to: security delete-generic-password -s ${SERVICE}`,
    );
  }
  const { privateKey } = generateKeyPairSync('ed25519');
  const secret = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  // `security -i` reads the command from stdin, so the key never shows in a process listing.
  execFileSync(SECURITY, ['-i'], {
    input: `add-generic-password -a taalcut -s ${SERVICE} -w ${secret}\n`,
    stdio: ['pipe', 'ignore', 'inherit'],
  });
  const { keyId, publicKey } = publicHalf(privateKey);
  const stored = readKeychain();
  if (!stored || publicHalf(parsePrivateKey(stored)).keyId !== keyId)
    fail('the key did not reach the keychain');
  console.log(`New manifest signing key ${keyId}, stored in the keychain as '${SERVICE}'.

Pin it in packages/jobs/src/components/trusted-keys.ts (at most two keys: current and next):

  { keyId: '${keyId}', publicKey: '${publicKey}' },

Keep an offline backup of the private key (Keychain Access, item '${SERVICE}'). Without it no new
manifest can be signed for builds that trust only this key.`);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    sequence: { type: 'string' },
    'valid-days': { type: 'string' },
    'not-after': { type: 'string' },
    generate: { type: 'boolean' },
    help: { type: 'boolean' },
  },
});
if (values.help) console.log(USAGE);
else if (values.generate) generate();
else if (positionals.length === 1) signFile(positionals[0], values);
else fail(USAGE);
