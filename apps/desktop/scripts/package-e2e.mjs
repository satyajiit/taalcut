// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Builds the packages the packaged e2e tests run against (ad-hoc signed
 * unless TAALCUT_MAC_IDENTITY is set; never notarised, whatever the keychain
 * holds; with sidecars from TAALCUT_SIDECAR_DIR or tools/ffmpeg/dist if present).
 * The mac helper is built first (native/mac-helper/build.sh): every bundle bakes
 * in its pin, and packaging refuses one without it (packaging/mac-helper.ts).
 *
 *   release/mac-arm64/Taalcut.app        release build, 0.0.0
 *   release/test/mac-arm64/Taalcut.app   test build, 0.0.0 (update version N)
 *   release/update/                      test build 0.0.1 as a zip + latest-mac.yml (N+1)
 *   release/alpha/mac-arm64/Taalcut.app  test build 0.0.0-alpha.1 (channel client)
 *   release/alpha-next/mac-arm64/        test build 0.0.0-alpha.2 (zipped by the e2e as alpha-mac.yml)
 *   release/beta-1, beta-2, beta-3/      test builds 0.0.0-beta.1 (the beta client), .2 and .3, each with its
 *                                        zip and blockmap (P3-B9: the e2e publishes them with scripts/rollout)
 *   release/beta-2-broken/               0.0.0-beta.2 baked with TAALCUT_TEST_UPDATE_FAULT=exit-before-ready:
 *                                        an update that never starts, for the rollback guard
 *
 *   node scripts/package-e2e.mjs            all of them
 *   node scripts/package-e2e.mjs --update   the test build, N+1 and the two alpha builds
 *
 * Every test build trusts the e2e's update manifest key (scripts/rollout/manifest-signature.ts testSigningKey,
 * security review SB-19); the e2e signs its feeds with it. Release builds never trust it.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicKeyBase64, testSigningKey } from '../../../scripts/rollout/manifest-signature.ts';

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const updateOnly = process.argv.includes('--update');
const BUILDER = [
  'exec',
  'electron-builder',
  '--config',
  'electron-builder.config.ts',
  '--arm64',
  '--publish',
  'never',
  // These local fixtures test signed app bytes and real update hashes/blockmaps. Compression adds no coverage;
  // store the ZIP entries so the nine-fixture matrix does not repeatedly compress the same Electron runtime.
  // Production packaging uses its normal compression settings.
  '-c.compression=store',
];

const TEST_UPDATE_KEY = publicKeyBase64(testSigningKey());

/** Runs pnpm in apps/desktop; drops electron-builder's one enormous dependency line. */
function pnpm(args, env = {}) {
  // Test builds bake the e2e's manifest key; a release build would refuse it (packaging/build-settings.ts).
  const updateKey =
    env.TAALCUT_BUILD_FLAVOUR === 'test' ? { TAALCUT_UPDATE_PUBLIC_KEY: TEST_UPDATE_KEY } : {};
  const result = spawnSync('pnpm', args, {
    cwd: desktopDir,
    env: { ...process.env, TAALCUT_NOTARIZE: '0', ...updateKey, ...env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout}${result.stderr}`
    .split('\n')
    .filter((line) => !line.includes('duplicate dependency references'))
    .join('\n');
  process.stdout.write(output);
  if (result.status !== 0) {
    process.stderr.write(`\npnpm ${args.join(' ')} failed (${result.status ?? result.signal})\n`);
    process.exit(1);
  }
}

// LNX1-PKG: the packaged e2e is the macOS app's (e2e/packaged-app.ts PACKAGED_UNAVAILABLE); elsewhere nothing is
// built and the packaged tests skip saying why. A Linux .deb: package:linux, then scripts/linux/verify-deb.mjs.
if (process.platform !== 'darwin') {
  process.stdout.write(
    `package-e2e: the packaged e2e builds the macOS app; nothing to build on ${process.platform}\n`,
  );
  process.exit(0);
}

pnpm(['run', 'build:mac-helper']);

if (!updateOnly) {
  pnpm(['run', 'build:placeholder'], { TAALCUT_BUILD_FLAVOUR: 'release' });
  pnpm([...BUILDER, '--mac', '--dir'], { TAALCUT_APP_VERSION: '0.0.0' });
}

// P3-B9's broken build first: its bundle is baked with the fault, and the bundle built next replaces it.
pnpm(['run', 'build:placeholder'], {
  TAALCUT_BUILD_FLAVOUR: 'test',
  TAALCUT_TEST_UPDATE_FAULT: 'exit-before-ready',
});
pnpm([...BUILDER, '--mac', 'zip'], {
  TAALCUT_APP_VERSION: '0.0.0-beta.2',
  TAALCUT_PACKAGE_OUTPUT: join('release', 'beta-2-broken'),
});

pnpm(['run', 'build:placeholder'], { TAALCUT_BUILD_FLAVOUR: 'test' });
// The zip target (not --dir) because electron-builder writes Resources/app-update.yml,
// which electron-updater needs, only for update-capable targets. Only the .app is kept.
// Keep the fixture's N fixed even after the real app's package.json version advances.
pnpm([...BUILDER, '--mac', 'zip'], { TAALCUT_APP_VERSION: '0.0.0' });
dropFeedFiles(join(desktopDir, 'release', 'test'));
pnpm([...BUILDER, '--mac', 'zip'], {
  TAALCUT_APP_VERSION: '0.0.1',
  TAALCUT_PACKAGE_OUTPUT: join('release', 'update'),
});
// The feed needs only the zip and latest-mac.yml.
rmSync(join(desktopDir, 'release', 'update', 'mac-arm64'), { recursive: true, force: true });
// Channel clients. Same signed test build, version overridden. The e2e writes alpha-mac.yml.
for (const [version, output] of [
  ['0.0.0-alpha.1', 'alpha'],
  ['0.0.0-alpha.2', 'alpha-next'],
]) {
  pnpm([...BUILDER, '--mac', 'zip'], {
    TAALCUT_APP_VERSION: version,
    TAALCUT_PACKAGE_OUTPUT: join('release', output),
  });
  dropFeedFiles(join(desktopDir, 'release', output));
}

// The public beta channel (P3-B9): the e2e publishes these zips (and their blockmaps) with scripts/rollout.
for (const [version, output] of [
  ['0.0.0-beta.1', 'beta-1'],
  ['0.0.0-beta.2', 'beta-2'],
  ['0.0.0-beta.3', 'beta-3'],
]) {
  pnpm([...BUILDER, '--mac', 'zip'], {
    TAALCUT_APP_VERSION: version,
    TAALCUT_PACKAGE_OUTPUT: join('release', output),
  });
}

/** Drops the zip, blockmap and yml next to an output dir and keeps mac-arm64/Taalcut.app. */
function dropFeedFiles(dir) {
  for (const file of readdirSync(dir)) {
    if (/\.(zip|blockmap|yml)$/.test(file)) rmSync(join(dir, file));
  }
}
