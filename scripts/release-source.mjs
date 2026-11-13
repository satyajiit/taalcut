// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Stage the pinned corresponding source before the manual publisher can create a GitHub release. */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SOURCE_METADATA,
  assertSourceBuild,
  readSourceDistribution,
  sourceArtifacts,
} from './rollout/source-artifacts.ts';

const destination = process.argv[2];
if (!destination) throw new Error('usage: node scripts/release-source.mjs <artifact-directory>');
const metadata = fileURLToPath(new URL('../tools/ffmpeg/source-distribution.json', import.meta.url));
const source = readSourceDistribution(metadata);
assertSourceBuild(
  metadata,
  fileURLToPath(new URL('../tools/ffmpeg/dist/BUILDINFO.json', import.meta.url)),
  'darwin-arm64',
);
mkdirSync(destination, { recursive: true });
const scratch = mkdtempSync(join(destination, '.source-'));
try {
  const name = basename(new URL(source.url).pathname);
  copyFileSync(metadata, join(scratch, SOURCE_METADATA));
  execFileSync(
    'curl',
    [
      '--fail',
      '--silent',
      '--show-error',
      '--location',
      '--proto',
      '=https',
      '--proto-redir',
      '=https',
      '--retry',
      '3',
      '--max-time',
      '600',
      '--output',
      join(scratch, name),
      source.url,
    ],
    { stdio: 'inherit' },
  );
  sourceArtifacts(scratch, true);
  renameSync(join(scratch, name), join(destination, name));
  renameSync(join(scratch, SOURCE_METADATA), join(destination, SOURCE_METADATA));
  process.stdout.write(`Staged verified corresponding source: ${name}\n`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
