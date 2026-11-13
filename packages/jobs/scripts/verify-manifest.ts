// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Checks a signed manifest exactly as a build of this checkout will load it:
 * the pinned keys (src/components/trusted-keys.ts), the signature, the schema
 * and notAfter. Release mode by default, so the development key is refused.
 *
 *   pnpm --filter @taalcut/jobs run manifest:verify <signed.json> [--development] [--after <sequence>]
 *
 * `--after N` also applies the rollback check against the last published sequence.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { TRUSTED_MANIFEST_KEYS, verifySignedManifest } from '../src/index';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { development: { type: 'boolean' }, after: { type: 'string' } },
});
if (positionals.length !== 1) {
  console.error('Usage: manifest:verify <signed.json> [--development] [--after <sequence>]');
  process.exit(2);
}
// pnpm runs package scripts in the package folder; resolve the path from where it was typed.
const path = resolve(process.env.INIT_CWD ?? process.cwd(), positionals[0]!);
const result = verifySignedManifest(JSON.parse(readFileSync(path, 'utf8')), {
  trustedKeys: TRUSTED_MANIFEST_KEYS,
  release: !values.development,
  ...(values.after !== undefined ? { lastSequence: Number(values.after) } : {}),
  now: Date.now(),
});
if (!result.ok) {
  const reason = result.error.params?.reason ? ` (${String(result.error.params.reason)})` : '';
  console.error(`${path}: refused, ${result.error.code}${reason}: ${result.error.detail ?? ''}`);
  process.exit(1);
}
const { sequence, notAfter, keyId, manifest } = result.value;
process.stdout.write(
  `${path}: OK. sequence ${sequence}, notAfter ${notAfter}, key ${keyId}, ` +
    `${manifest.components.length} components: ${manifest.components.map((c) => `${c.id}@${c.version}`).join(', ')}\n`,
);
