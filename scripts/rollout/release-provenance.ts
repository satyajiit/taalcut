// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Exec } from './release-store.ts';

interface GitObject {
  readonly type: 'commit' | 'tag';
  readonly sha: string;
}

function gitObject(text: string): GitObject {
  const object = JSON.parse(text) as Partial<GitObject>;
  if (!['commit', 'tag'].includes(object.type ?? '') || !/^[0-9a-f]{40}$/.test(object.sha ?? '')) {
    throw new Error('GitHub returned an invalid release tag object');
  }
  return object as GitObject;
}

/** Creates only a missing tag; an existing lightweight or annotated tag must resolve to the build's commit. */
export async function ensureVersionTag(repo: string, tag: string, commit: string, exec: Exec): Promise<void> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`not a repository: ${repo}`);
  if (!/^v\d+\.\d+\.\d+(-beta\.\d+)?$/.test(tag)) throw new Error(`not a release tag: ${tag}`);
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("--commit must be the build run's full commit SHA");
  const api = async (path: string, ...args: string[]) =>
    gitObject((await exec('gh', ['api', `repos/${repo}/git/${path}`, ...args, '--jq', '.object'])).stdout);
  let object: GitObject;
  try {
    object = await api(`ref/tags/${tag}`);
  } catch (cause) {
    const stderr = String((cause as { stderr?: string }).stderr ?? '');
    if (!/\(HTTP 404\)/.test(stderr)) throw cause;
    // POST is create-only. A concurrent creation fails; we never PATCH or force-update a release tag.
    object = await api('refs', '--method', 'POST', '-f', `ref=refs/tags/${tag}`, '-f', `sha=${commit}`);
  }
  for (let depth = 0; object.type === 'tag' && depth < 8; depth += 1) {
    object = await api(`tags/${object.sha}`);
  }
  if (object.type !== 'commit' || object.sha !== commit) {
    throw new Error(
      `${tag} does not point to build commit ${commit}; refusing to move an existing release tag`,
    );
  }
}
