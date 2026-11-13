// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { extract } from './archive.mjs';
import { listEntries, sha256File } from './files.mjs';
import { packRepoSource, repoFiles, sourcePath } from './sources.mjs';

let repo;
let scratch;
before(async () => {
  repo = await mkdtemp(join(tmpdir(), 'taalcut-sources-repo-'));
  scratch = await mkdtemp(join(tmpdir(), 'taalcut-sources-out-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  await mkdir(join(repo, 'tool', 'dist'), { recursive: true });
  await writeFile(join(repo, '.gitignore'), 'dist/\n');
  await writeFile(join(repo, 'tool', 'build.sh'), '#!/bin/sh\necho build\n');
  await chmod(join(repo, 'tool', 'build.sh'), 0o755);
  await writeFile(join(repo, 'tool', 'pack.mjs'), 'export {};\n');
  await writeFile(join(repo, 'tool', 'pack.test.mjs'), 'test\n');
  await writeFile(join(repo, 'tool', 'dist', 'binary'), 'built\n');
  await writeFile(join(repo, 'other.txt'), 'not asked for\n');
  git('add', 'tool/build.sh', '.gitignore');
});
after(() => Promise.all([repo, scratch].map((dir) => rm(dir, { recursive: true, force: true }))));

const spec = { paths: ['tool'], exclude: '\\.test\\.mjs$' };

describe('repo sources', () => {
  it("takes the paths' tracked and new files, not ignored ones or excluded ones", async () => {
    assert.deepEqual(await repoFiles(repo, spec), ['tool/build.sh', 'tool/pack.mjs']);
    await assert.rejects(repoFiles(repo, { paths: ['nothing'] }), /no files under nothing/);
  });

  it('packs the same files into the same bytes, at their repository paths and modes', async () => {
    const first = await packRepoSource(repo, spec, await mkdtemp(join(scratch, 'a-')));
    await utimes(join(repo, 'tool', 'pack.mjs'), new Date(), new Date());
    const second = await packRepoSource(repo, spec, await mkdtemp(join(scratch, 'b-')));
    assert.equal(await sha256File(first), await sha256File(second));
    const into = join(scratch, 'unpacked');
    await extract(first, 'tar.zst', into);
    assert.deepEqual(await listEntries(into), ['tool/build.sh', 'tool/pack.mjs']);
  });

  it('uses the hosted bytes once its key is hosted, the repository before', async () => {
    const pinOptions = { cacheDir: join(scratch, 'cache') };
    const source = { file: 'source/x.tar.zst', repo: spec };
    const where = { key: 'x/1/source/x.tar.zst', base: 'https://example.invalid', repo, pinOptions, scratch };
    const packed = await sourcePath(source, where);
    const hosted = {
      'x/1/source/x.tar.zst': { size: (await stat(packed)).size, sha256: await sha256File(packed) },
    };
    await writeFile(join(repo, 'tool', 'pack.mjs'), 'export const changed = true;\n');
    assert.equal(await sourcePath(source, { ...where, hosted }), packed);
    const fresh = await sourcePath(source, { ...where, key: 'x/2/source/x.tar.zst', hosted });
    assert.notEqual(await sha256File(fresh), hosted['x/1/source/x.tar.zst'].sha256);
    await assert.rejects(sourcePath({ file: 'x' }, where), /needs a pin or repo paths/);
  });
});
