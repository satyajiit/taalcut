// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readJson, runScript, STARTS_PROCESSES, withHub, writeRel } from './cli';
import { HUB_ID, template, templateRel } from './fixture';

const NOW = 1_700_000_000_000;
const OTHER = '01BRZ3NDEKTSV4RRFFQ69G5FAV';

interface IndexFile {
  readonly formatVersion: number;
  readonly generatedAt: number;
  readonly templates: {
    readonly id: string;
    readonly sha256: string;
    readonly slotStrip: number[];
    readonly createdAt: number;
    readonly updatedAt: number;
  }[];
}

const readIndex = (root: string) => readJson<IndexFile>(root, 'site/v0/index.json');
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe('build-index', STARTS_PROCESSES, () => {
  it('writes a deterministic index and a copy of the template', () => {
    withHub((root) => {
      writeRel(root, templateRel(), JSON.stringify(template()));
      const result = runScript('build-index.mjs', ['--root', root, '--now', String(NOW)]);
      expect(result.status, result.stderr).toBe(0);
      const index = readIndex(root);
      expect(index.formatVersion).toBe(0);
      expect(index.generatedAt).toBe(NOW);
      const entry = index.templates[0];
      expect(entry?.id).toBe(HUB_ID);
      expect(entry?.slotStrip).toEqual([30, 45, 15]);
      expect(entry?.createdAt).toBe(NOW);
      expect(entry?.updatedAt).toBe(NOW);
      expect(sha256(readFileSync(join(root, 'site', 'v0', 'templates', `${HUB_ID}.json`)))).toBe(entry?.sha256);
    });
  });

  it('lists the newest updatedAt first', () => {
    withHub((root) => {
      writeRel(root, templateRel(HUB_ID), JSON.stringify(template()));
      writeRel(root, templateRel(OTHER), JSON.stringify(template({ id: OTHER })));
      git(root, ['init', '--initial-branch=main']);
      history(root, [
        { branch: 'main', files: [templateRel(HUB_ID)], date: '2020-01-01T00:00:00Z', message: 'first' },
        { branch: 'main', files: [templateRel(OTHER)], date: '2021-06-01T00:00:00Z', message: 'second' },
      ]);
      const result = runScript('build-index.mjs', ['--root', root, '--now', String(NOW)]);
      expect(result.status, result.stderr).toBe(0);
      const index = readIndex(root);
      expect(index.templates.map((entry) => entry.id)).toEqual([OTHER, HUB_ID]);
      const [first, second] = index.templates;
      expect(first && second && first.updatedAt > second.updatedAt).toBe(true);
    });
  });

  it('a template whose pull request passes validate is in the index once it merges', () => {
    withHub((root) => {
      git(root, ['init', '--initial-branch=main']);
      writeRel(root, templateRel(), JSON.stringify(template()));
      history(root, [
        { branch: 'main', files: ['moderation/hidden.json'], date: '2026-10-01T00:00:00Z', message: 'seed' },
        {
          branch: 'share',
          from: 'main',
          files: [templateRel()],
          date: '2026-10-02T00:00:00Z',
          message: 'Add a template',
        },
      ]);
      const changed = join(root, 'changed.txt');
      writeFileSync(changed, git(root, ['diff', '--name-only', '--no-renames', 'main...share']));
      const checked = runScript('validate.mjs', ['--root', root, '--changed-list', changed, '--base', 'main']);
      expect(checked.status, checked.stderr).toBe(0);
      // It merges: share starts from main, so main fast-forwards to it. Publishing runs on main.
      git(root, ['update-ref', 'refs/heads/main', 'refs/heads/share']);
      const built = runScript('build-index.mjs', ['--root', root, '--now', String(NOW)]);
      expect(built.status, built.stderr).toBe(0);
      const entry = readIndex(root).templates.find((item) => item.id === HUB_ID);
      expect(entry?.sha256).toBe(sha256(readFileSync(join(root, templateRel()))));
      expect(entry?.createdAt).toBe(Date.parse('2026-10-02T00:00:00Z'));
    });
  });

  it('publishes nothing when a template on main fails the pull request checks', () => {
    withHub((root) => {
      writeRel(root, templateRel(), JSON.stringify(template({ description: 'more at https://cdn.example/x' })));
      const result = runScript('build-index.mjs', ['--root', root, '--now', String(NOW)]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('description: url');
      expect(existsSync(join(root, 'site', 'v0', 'index.json'))).toBe(false);
    });
  });
});

function git(root: string, args: string[]): string {
  return execFileSync('git', ['-c', 'advice.defaultBranchName=false', ...args], { cwd: root, encoding: 'utf8' });
}

interface Commit {
  readonly branch: string;
  /** The branch it starts from, when it is the first commit on `branch`. */
  readonly from?: string;
  /** Files to commit, as they are in the working tree. */
  readonly files: readonly string[];
  readonly date: string;
  readonly message: string;
}

/**
 * Makes the commits with one `git fast-import`, each dated `date` (the index's times come from git
 * log). The branches' refs move; the index and working tree stay as they are. One git process for the
 * whole history, not two per commit (STARTS_PROCESSES).
 */
function history(root: string, commits: readonly Commit[]): void {
  const stream: Buffer[] = [];
  const text = (value: string) => stream.push(Buffer.from(value));
  for (const commit of commits) {
    text(`commit refs/heads/${commit.branch}\n`);
    text(`committer hub <hub@example.invalid> ${Date.parse(commit.date) / 1000} +0000\n`);
    text(`data ${Buffer.byteLength(commit.message)}\n${commit.message}\n`);
    if (commit.from) text(`from refs/heads/${commit.from}\n`);
    for (const rel of commit.files) {
      const bytes = readFileSync(join(root, rel));
      text(`M 100644 inline ${rel}\ndata ${bytes.length}\n`);
      stream.push(bytes);
      text('\n');
    }
    text('\n');
  }
  execFileSync('git', ['fast-import', '--quiet'], { cwd: root, input: Buffer.concat(stream) });
}
