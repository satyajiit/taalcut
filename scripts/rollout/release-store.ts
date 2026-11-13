// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where releases live, behind one small port, so the publish, promote and pull scripts are the same code against
 * GitHub Releases (the workflows, through the `gh` CLI) and against a folder (the packaged update e2e and dry runs).
 * The folder mirrors GitHub's download URLs: <root>/<tag>/<asset> is .../releases/download/<tag>/<asset>, so a
 * plain file server over the folder is a faithful update feed. Asset names are flat on GitHub (no "/").
 */
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { ensureVersionTag } from './release-provenance.ts';

export interface ReleaseMeta {
  readonly title: string;
  readonly notes: string;
  readonly prerelease: boolean;
}

export interface ReleaseStore {
  /** undefined when the release doesn't exist. */
  release(tag: string): Promise<(ReleaseMeta & { readonly assets: readonly string[] }) | undefined>;
  /** Creates the release when it doesn't exist; never changes an existing one's title or notes. */
  ensure(tag: string, meta: ReleaseMeta): Promise<void>;
  editRelease(tag: string, meta: Partial<Pick<ReleaseMeta, 'title' | 'notes'>>): Promise<void>;
  /** An asset's text; undefined when the release or the asset doesn't exist. */
  readText(tag: string, asset: string): Promise<string | undefined>;
  /** Copies an asset to a local file; false when it doesn't exist. */
  download(tag: string, asset: string, to: string): Promise<boolean>;
  /** Uploads local files, each under its own base name, replacing assets of the same name. */
  upload(tag: string, files: readonly string[]): Promise<void>;
}

const META = '.release.json';

/** A folder laid out like GitHub's download URLs. */
export function dirReleaseStore(root: string): ReleaseStore {
  const dir = (tag: string) => join(root, safe(tag));
  const readMeta = (tag: string): ReleaseMeta | undefined => {
    const file = join(dir(tag), META);
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as ReleaseMeta) : undefined;
  };
  return {
    async release(tag) {
      const meta = readMeta(tag);
      if (!meta) return undefined;
      return {
        ...meta,
        assets: readdirSync(dir(tag))
          .filter((name) => name !== META)
          .sort(),
      };
    },
    async ensure(tag, meta) {
      if (readMeta(tag)) return;
      mkdirSync(dir(tag), { recursive: true });
      writeFileSync(join(dir(tag), META), `${JSON.stringify(meta, null, 2)}\n`);
    },
    async editRelease(tag, change) {
      const meta = readMeta(tag);
      if (!meta) throw new Error(`no release ${tag}`);
      writeFileSync(join(dir(tag), META), `${JSON.stringify({ ...meta, ...change }, null, 2)}\n`);
    },
    async readText(tag, asset) {
      const file = join(dir(tag), safe(asset));
      return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
    },
    async download(tag, asset, to) {
      const file = join(dir(tag), safe(asset));
      if (!existsSync(file)) return false;
      copyFileSync(file, to);
      return true;
    },
    async upload(tag, files) {
      if (!readMeta(tag)) throw new Error(`no release ${tag}`);
      for (const file of files) copyFileSync(file, join(dir(tag), safe(basename(file))));
    },
  };
}

export type Exec = (command: string, args: readonly string[]) => Promise<{ stdout: string }>;

const execFileAsync = promisify(execFile);
export const runGh: Exec = (command, args) =>
  execFileAsync(command, [...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** GitHub Releases through the `gh` CLI (GH_TOKEN from the workflow). `repo` is owner/name. */
export function ghReleaseStore(repo: string, exec: Exec = runGh, commit?: string): ReleaseStore {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`not a repository: ${repo}`);
  const gh = (...args: string[]) => exec('gh', [...args, '--repo', repo]);
  const store: ReleaseStore = {
    async release(tag) {
      let stdout: string;
      try {
        ({ stdout } = await gh('release', 'view', safe(tag), '--json', 'name,body,isPrerelease,assets'));
      } catch (cause) {
        if (/not found/i.test(String((cause as { stderr?: string }).stderr ?? cause))) return undefined;
        throw cause;
      }
      const view = JSON.parse(stdout) as {
        name: string;
        body: string;
        isPrerelease: boolean;
        assets: { name: string }[];
      };
      return {
        title: view.name,
        notes: view.body,
        prerelease: view.isPrerelease,
        assets: view.assets.map((asset) => asset.name).sort(),
      };
    },
    async ensure(tag, meta) {
      const versioned = /^v\d/.test(tag);
      if (versioned) await ensureVersionTag(repo, tag, commit ?? '', exec);
      if (await store.release(tag)) return;
      await gh(
        'release',
        'create',
        safe(tag),
        '--title',
        meta.title,
        '--notes',
        meta.notes,
        ...(versioned ? ['--verify-tag'] : []),
        // Channel and beta releases must never become "latest" (stable clients would never see them anyway,
        // but the repository's front page would).
        ...(meta.prerelease ? ['--prerelease', '--latest=false'] : ['--latest']),
      );
    },
    async editRelease(tag, change) {
      await gh(
        'release',
        'edit',
        safe(tag),
        ...(change.title !== undefined ? ['--title', change.title] : []),
        ...(change.notes !== undefined ? ['--notes', change.notes] : []),
      );
    },
    async readText(tag, asset) {
      const release = await store.release(tag);
      if (!release?.assets.includes(asset)) return undefined;
      return (await gh('release', 'download', safe(tag), '--pattern', safe(asset), '--output', '-')).stdout;
    },
    async download(tag, asset, to) {
      const release = await store.release(tag);
      if (!release?.assets.includes(asset)) return false;
      await gh('release', 'download', safe(tag), '--pattern', safe(asset), '--output', to, '--clobber');
      return true;
    },
    async upload(tag, files) {
      await gh('release', 'upload', safe(tag), ...files, '--clobber');
    },
  };
  return store;
}

/** Tags and asset names are plain: no path separators, no globbing, nothing that reads as a flag. */
function safe(name: string): string {
  if (!/^[A-Za-z0-9][\w.+-]*$/.test(name)) throw new Error(`unsafe release or asset name: ${name}`);
  return name;
}
