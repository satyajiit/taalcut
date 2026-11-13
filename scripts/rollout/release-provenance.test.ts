// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { run } from './cli.ts';
import { ensureVersionTag } from './release-provenance.ts';
import { ghReleaseStore, type Exec } from './release-store.ts';

const REPO = 'taalcut/taalcut';
const TAG = 'v1.0.0-beta.1';
const BUILD = 'a'.repeat(40);
const LATER_MAIN = 'b'.repeat(40);
const ANNOTATION = 'c'.repeat(40);
const object = (sha: string, type = 'commit') => ({ stdout: JSON.stringify({ type, sha }) });
const httpError = (status: number) =>
  Object.assign(new Error('GitHub request failed'), { stderr: `gh: failed (HTTP ${status})` });

describe('release source provenance', () => {
  it('creates a missing tag at the build commit even when main has advanced, then requires that tag', async () => {
    const calls: string[][] = [];
    let tag: string | undefined;
    const exec: Exec = async (_command, args) => {
      calls.push([...args]);
      if (args[0] === 'api') {
        if (args.includes('POST')) {
          tag = args.find((arg) => arg.startsWith('sha='))?.slice(4);
          return object(tag ?? LATER_MAIN);
        }
        if (!tag) throw httpError(404);
        return object(tag);
      }
      if (args[1] === 'view') throw Object.assign(new Error('missing'), { stderr: 'release not found' });
      return { stdout: '' };
    };
    await ghReleaseStore(REPO, exec, BUILD).ensure(TAG, { title: 'Beta', notes: '- New', prerelease: true });
    expect(tag).toBe(BUILD);
    expect(calls.find((args) => args.includes('POST'))).toEqual([
      'api',
      `repos/${REPO}/git/refs`,
      '--method',
      'POST',
      '-f',
      `ref=refs/tags/${TAG}`,
      '-f',
      `sha=${BUILD}`,
      '--jq',
      '.object',
    ]);
    expect(calls.find((args) => args[1] === 'create')).toContain('--verify-tag');
    expect(calls.flat()).not.toContain(LATER_MAIN);
  });

  it('accepts a pre-existing matching lightweight tag without rewriting it', async () => {
    const calls: string[][] = [];
    await ensureVersionTag(REPO, TAG, BUILD, async (_command, args) => {
      calls.push([...args]);
      return object(BUILD);
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`repos/${REPO}/git/ref/tags/${TAG}`);
    expect(calls.flat()).not.toContain('POST');
  });

  it('peels an annotated tag to its source commit', async () => {
    const paths: string[] = [];
    await ensureVersionTag(REPO, TAG, BUILD, async (_command, args) => {
      paths.push(args[1] ?? '');
      return paths.length === 1 ? object(ANNOTATION, 'tag') : object(BUILD);
    });
    expect(paths).toEqual([`repos/${REPO}/git/ref/tags/${TAG}`, `repos/${REPO}/git/tags/${ANNOTATION}`]);
  });

  it('refuses an existing tag on another commit before release creation or any mutation', async () => {
    const calls: string[][] = [];
    const exec: Exec = async (_command, args) => {
      calls.push([...args]);
      if (args[1] === 'view') throw Object.assign(new Error('missing'), { stderr: 'release not found' });
      return object(LATER_MAIN);
    };
    await expect(
      ghReleaseStore(REPO, exec, BUILD).ensure(TAG, {
        title: 'Beta',
        notes: '- New',
        prerelease: true,
      }),
    ).rejects.toThrow(/refusing to move/);
    expect(calls.some((args) => args[1] === 'create' || args.includes('POST'))).toBe(false);
  });

  it('does not treat authentication failures as missing tags', async () => {
    let calls = 0;
    await expect(
      ensureVersionTag(REPO, TAG, BUILD, async () => {
        calls += 1;
        throw httpError(403);
      }),
    ).rejects.toThrow(/GitHub request failed/);
    expect(calls).toBe(1);
  });

  it('checks the tag even when the GitHub release already exists', async () => {
    const exec: Exec = async (_command, args) =>
      args[0] === 'api'
        ? object(LATER_MAIN)
        : { stdout: JSON.stringify({ name: 'Beta', body: '- New', isPrerelease: true, assets: [] }) };
    await expect(
      ghReleaseStore(REPO, exec, BUILD).ensure(TAG, { title: 'Beta', notes: '- New', prerelease: true }),
    ).rejects.toThrow(/refusing to move/);
  });

  it('fails a concurrent tag creation instead of overwriting the competing tag', async () => {
    const calls: string[][] = [];
    await expect(
      ensureVersionTag(REPO, TAG, BUILD, async (_command, args) => {
        calls.push([...args]);
        throw httpError(calls.length === 1 ? 404 : 422);
      }),
    ).rejects.toThrow(/GitHub request failed/);
    expect(calls).toHaveLength(2);
    expect(calls.flat()).not.toContain('PATCH');
  });

  it('requires a full build commit before contacting GitHub', async () => {
    let called = false;
    await expect(
      ensureVersionTag(REPO, TAG, 'main', async () => {
        called = true;
        return object(BUILD);
      }),
    ).rejects.toThrow(/full commit SHA/);
    expect(called).toBe(false);
    const errors: string[] = [];
    expect(
      await run(
        ['publish', '--repo', REPO],
        {
          stdout: () => undefined,
          stderr: (text) => errors.push(text),
        },
        {},
      ),
    ).toBe(1);
    expect(errors.join('')).toContain('--commit is required');
  });
});
