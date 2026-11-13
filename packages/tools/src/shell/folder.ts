// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A project's shell folder (AGT2 sbx): `<root>/<projectId>/`, the one place the workspace shell may write.
 *
 *   work/    the workspace's head revision, checked out before each command and read back after it
 *   inputs/  library media, APFS clones, read-only (the profile refuses writes; the files are 0444)
 *   out/     media the commands make: videos and images too large for a revision; workspace.importMedia keeps one
 *   tmp/     TMPDIR
 *   home/    HOME
 *   shell.json  the manifest (which inputs are which asset): trusted code writes it, the profile refuses the shell
 *
 * The root is `<userData>/shell`, beside the workspaces' blobs and never inside a library source.
 */
import { constants as fsc } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { z } from 'zod';
import {
  err,
  isId,
  ok,
  ValidationError,
  type AssetId,
  type AsyncResult,
  type ProjectId,
} from '@taalcut/core';
import { SHELL_PORTS, SHELL_PORTS_ENV } from './loopback';

export const SHELL_ROOT_DIR = 'shell';
export const SHELL_MANIFEST = 'shell.json';
export const SHELL_DIRS = { work: 'work', inputs: 'inputs', out: 'out', tmp: 'tmp', home: 'home' } as const;
/** A clone that can't be made (another volume, no APFS) is copied only up to this. */
export const MAX_INPUT_COPY_BYTES = 2 * 1024 ** 3;
/** Inputs one folder holds. */
export const MAX_SHELL_INPUTS = 32;

const manifestSchema = z.object({
  version: z.literal(1),
  projectId: z.string(),
  createdAt: z.int(),
  usedAt: z.int(),
  inputs: z
    .array(z.object({ assetId: z.string(), file: z.string(), bytes: z.int().nonnegative() }))
    .max(MAX_SHELL_INPUTS),
});
export type ShellManifest = z.output<typeof manifestSchema>;
export type ShellInput = ShellManifest['inputs'][number];

/** `<root>/<projectId>`. Throws for a string that isn't an id: a bug, never a model's input. */
export function shellFolderOf(root: string, projectId: ProjectId): string {
  if (!isId(projectId)) throw new Error('Not a project id');
  return join(root, projectId);
}

export async function readShellManifest(folder: string): Promise<ShellManifest | null> {
  const text = await readFile(join(folder, SHELL_MANIFEST), 'utf8').catch(() => null);
  if (text === null) return null;
  try {
    const parsed = manifestSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function writeManifest(folder: string, manifest: ShellManifest): Promise<number> {
  const temp = join(folder, `${SHELL_MANIFEST}.${process.pid}.tmp`);
  const target = join(folder, SHELL_MANIFEST);
  await writeFile(temp, `${JSON.stringify(manifest)}\n`);
  await rename(temp, target);
  const info = await stat(target).catch(() => null);
  return info?.mtimeMs ?? 0;
}

interface CachedShellFolder {
  folder: string;
  manifest: ShellManifest;
  lastDiskUsedAt: number;
  manifestMtimeMs: number;
}

const rootRealpathCache = new Map<string, string>();
const folderCache = new Map<string, CachedShellFolder>();

function findCachedByFolder(folder: string): CachedShellFolder | undefined {
  for (const entry of folderCache.values()) {
    if (entry.folder === folder) return entry;
  }
  return undefined;
}

/** Makes the folder (once) and stamps its use; answers its real path and manifest. */
export async function ensureShellFolder(
  root: string,
  projectId: ProjectId,
  now: number,
): AsyncResult<{ readonly folder: string; readonly manifest: ShellManifest }> {
  const wanted = shellFolderOf(root, projectId);
  const cachedBase = rootRealpathCache.get(root);
  if (cachedBase) {
    const key = `${cachedBase}:${projectId}`;
    const cached = folderCache.get(key);
    if (cached) {
      const [dirInfo, manifestInfo] = await Promise.all([
        stat(cached.folder).catch(() => null),
        stat(join(cached.folder, SHELL_MANIFEST)).catch(() => null),
      ]);
      if (
        dirInfo?.isDirectory() &&
        manifestInfo?.isFile() &&
        manifestInfo.mtimeMs === cached.manifestMtimeMs
      ) {
        const manifest: ShellManifest = { ...cached.manifest, usedAt: now };
        cached.manifest = manifest;
        if (now - cached.lastDiskUsedAt >= 60_000) {
          cached.manifestMtimeMs = await writeManifest(cached.folder, manifest);
          cached.lastDiskUsedAt = now;
        }
        return ok({ folder: cached.folder, manifest });
      }
      folderCache.delete(key);
      rootRealpathCache.delete(root);
    }
  }

  await mkdir(wanted, { recursive: true });
  await Promise.all(Object.values(SHELL_DIRS).map((dir) => mkdir(join(wanted, dir), { recursive: true })));
  const base = await realpath(root);
  rootRealpathCache.set(root, base);
  const folder = join(base, projectId);
  const found = await readShellManifest(folder);
  const manifest: ShellManifest =
    found && found.projectId === projectId
      ? { ...found, usedAt: now }
      : { version: 1, projectId, createdAt: now, usedAt: now, inputs: [] };
  const manifestMtimeMs = await writeManifest(folder, manifest);
  folderCache.set(`${base}:${projectId}`, { folder, manifest, lastDiskUsedAt: now, manifestMtimeMs });
  return ok({ folder, manifest });
}

/** A file extension for a clone: the source's, if it is plain and short. */
function cloneExtension(source: string): string {
  const ext = extname(source).slice(1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? `.${ext}` : '';
}

/**
 * Clones library media into `inputs/` (APFS `clonefile` through COPYFILE_FICLONE_FORCE: instant, no disk until
 * changed), read-only. A source on a volume that can't clone is copied when it is small enough. An input already
 * there with the same size is kept. Answers the manifest's inputs after it.
 */
export async function cloneInputs(
  folder: string,
  inputs: readonly { readonly assetId: AssetId; readonly path: string }[],
): AsyncResult<readonly ShellInput[]> {
  const cached = findCachedByFolder(folder);
  const manifestInfo = cached ? await stat(join(folder, SHELL_MANIFEST)).catch(() => null) : null;
  const hasFreshCache = Boolean(
    cached && manifestInfo?.isFile() && manifestInfo.mtimeMs === cached.manifestMtimeMs,
  );
  const manifest = hasFreshCache && cached ? cached.manifest : await readShellManifest(folder);
  if (!manifest)
    return err(ValidationError({ field: 'projectId' }, { detail: 'The shell folder has no manifest' }));
  if (inputs.length === 0) return ok(manifest.inputs);
  const kept = new Map(manifest.inputs.map((input) => [input.assetId, input]));
  let dirty = false;
  for (const { assetId, path } of inputs) {
    const facts = await stat(path).catch(() => null);
    if (!facts?.isFile())
      return err(
        ValidationError({ field: 'inputs' }, { detail: `asset ${assetId}: its media file isn't there` }),
      );
    const file = `${SHELL_DIRS.inputs}/${assetId}${cloneExtension(path)}`;
    const target = join(folder, file);
    const there = await stat(target).catch(() => null);
    if (!there || there.size !== facts.size) {
      const staged = `${target}.${process.pid}.part`;
      await rm(staged, { force: true });
      const cloned = await copyFile(path, staged, fsc.COPYFILE_FICLONE_FORCE).then(
        () => true,
        () => false,
      );
      if (!cloned) {
        if (facts.size > MAX_INPUT_COPY_BYTES)
          return err(
            ValidationError(
              { field: 'inputs' },
              { detail: `asset ${assetId}: its volume can't clone it and it is too large to copy` },
            ),
          );
        await copyFile(path, staged);
      }
      await chmod(staged, 0o444);
      await rm(target, { force: true });
      await rename(staged, target);
      dirty = true;
    }
    const prev = kept.get(assetId);
    if (!prev || prev.file !== file || prev.bytes !== facts.size) dirty = true;
    kept.set(assetId, { assetId, file, bytes: facts.size });
  }
  if (kept.size > MAX_SHELL_INPUTS)
    return err(
      ValidationError(
        { field: 'inputs' },
        { detail: `A shell folder holds at most ${MAX_SHELL_INPUTS} inputs` },
      ),
    );
  const next = { ...manifest, inputs: [...kept.values()] };
  if (dirty) {
    const mtimeMs = await writeManifest(folder, next);
    if (cached) cached.manifestMtimeMs = mtimeMs;
  }
  if (cached) cached.manifest = next;
  return ok(next.inputs);
}

/** At most this many toolchain folders reach the profile (TOOLS_0 … TOOLS_7). */
export const MAX_TOOL_ROOTS = 8;
/** What unused params name: a literal nobody can read or run anything through. */
const UNUSED = '/dev/null';

/**
 * workspace.sb's params, in a fixed order. Every path is a real path; each LOOPBACK_n is one of the run's loopback
 * ports (loopback.ts), as `localhost:<port>`.
 */
export function shellProfileParams(
  folder: string,
  toolRoots: readonly string[],
  ports: readonly number[],
): [string, string][] {
  if (toolRoots.length > MAX_TOOL_ROOTS) throw new Error(`At most ${MAX_TOOL_ROOTS} toolchain folders`);
  if (
    ports.length !== SHELL_PORTS ||
    ports.some((port) => !Number.isInteger(port) || port <= 0 || port > 65535)
  )
    throw new Error(`A run opens exactly ${SHELL_PORTS} loopback ports`);
  return [
    ['WS', folder],
    ['MANIFEST', join(folder, SHELL_MANIFEST)],
    ['INPUTS', join(folder, SHELL_DIRS.inputs)],
    ...Array.from({ length: MAX_TOOL_ROOTS }, (_, i): [string, string] => [
      `TOOLS_${i}`,
      toolRoots[i] ?? UNUSED,
    ]),
    ...ports.map((port, i): [string, string] => [`LOOPBACK_${i}`, `localhost:${port}`]),
  ];
}

/** The toolchain the shell gets: component folders to read and run, PATH entries, and their environment. */
export interface ShellToolchain {
  /** Folders the shell may read and run (each component's), real paths, at most 8. */
  readonly roots: readonly string[];
  /** Put first on PATH, in order. */
  readonly bin: readonly string[];
  /** Variables the tools need (where the headless shell is, …): paths and switches, never a secret. */
  readonly env: Readonly<Record<string, string>>;
  /** What the agent is told it has. */
  readonly programs: readonly { readonly name: string; readonly version: string }[];
}

export const NO_TOOLCHAIN: ShellToolchain = { roots: [], bin: [], env: {}, programs: [] };

/**
 * The child's whole environment: HOME and TMPDIR inside the folder, the toolchain first on PATH, the run's loopback
 * ports, no secrets.
 */
export function shellEnv(
  folder: string,
  toolchain: ShellToolchain,
  ports: readonly number[] = [],
): Record<string, string> {
  const tmp = join(folder, SHELL_DIRS.tmp);
  return {
    PATH: [...toolchain.bin, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
    HOME: join(folder, SHELL_DIRS.home),
    TMPDIR: tmp,
    LANG: 'en_US.UTF-8',
    TERM: 'dumb',
    NO_COLOR: '1',
    PYTHONNOUSERSITE: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONUNBUFFERED: '1',
    XDG_CACHE_HOME: join(tmp, 'cache'),
    npm_config_cache: join(tmp, 'npm'),
    npm_config_offline: 'true',
    npm_config_update_notifier: 'false',
    ...(ports.length > 0 ? { [SHELL_PORTS_ENV]: ports.join(',') } : {}),
    ...toolchain.env,
  };
}
