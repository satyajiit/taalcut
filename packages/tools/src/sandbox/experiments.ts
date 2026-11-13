// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Experiment folders: `<root>/<experimentId>/` with an `experiment.json`
 * manifest. Shared by both sandbox modes, because listing, reading, discarding
 * and sweeping never start a child. Expired experiments are gone as far as
 * callers are concerned, even before the sweep removes the folder.
 */
import type { Dirent } from 'node:fs';
import { mkdir, open as openFile, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  EXPERIMENT_PURPOSES,
  err,
  idSchema,
  isId,
  ok,
  systemClock,
  type AsyncResult,
  type Clock,
  type Experiment,
  type ExperimentId,
  type ExperimentPurpose,
  type ProjectId,
  type SandboxFile,
} from '@taalcut/core';
import { SandboxDiscardFailed, SandboxExperimentNotFound, SandboxPathOutside } from './errors';
import {
  COOKIES_FILE,
  folderBytes,
  isInside,
  MANIFEST_FILE,
  resolveInside,
  SCRATCH_PREFIX,
  TMP_DIR,
  walkFiles,
} from './paths';

/** Two hours from last use (SPEC "Lifecycle"). */
export const DEFAULT_EXPERIMENT_TTL_MS = 2 * 60 * 60 * 1000;
/** A manifest that claims to live longer than this was tampered with: the sweep removes it. */
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_READ_BYTES = 64 * 1024;
const MAX_LISTING = 1000;

const manifestSchema = z.object({
  version: z.literal(1),
  id: idSchema<'Experiment'>(),
  projectId: idSchema<'Project'>().nullable(),
  purpose: z.enum(EXPERIMENT_PURPOSES),
  createdAt: z.int().nonnegative(),
  expiresAt: z.int().nonnegative(),
  ttlMs: z.int().positive().max(MAX_TTL_MS),
});
type Manifest = z.output<typeof manifestSchema>;

export interface ExperimentFolders {
  readonly root: () => Promise<string>;
  open(input: {
    readonly id: ExperimentId;
    readonly projectId: ProjectId | null;
    readonly purpose: ExperimentPurpose;
    readonly ttlMs?: number;
  }): AsyncResult<Experiment>;
  get(id: ExperimentId): AsyncResult<Experiment>;
  /** Extends the TTL from now: every run, listing and read is a use. */
  touch(id: ExperimentId): AsyncResult<Experiment>;
  list(id: ExperimentId, dir?: string): AsyncResult<SandboxFile[]>;
  readText(id: ExperimentId, path: string, maxBytes?: number): AsyncResult<string>;
  discard(id: ExperimentId): AsyncResult<{ readonly freedBytes: number }>;
  sweep(): AsyncResult<{ readonly removed: readonly ExperimentId[] }>;
}

function toExperiment(manifest: Manifest, dir: string): Experiment {
  return {
    id: manifest.id,
    projectId: manifest.projectId,
    purpose: manifest.purpose,
    dir,
    createdAt: manifest.createdAt,
    expiresAt: manifest.expiresAt,
  };
}

/** `scratch:a/b` or `a/b` → `a/b`. */
export function stripScratch(path: string): string {
  return path.startsWith(SCRATCH_PREFIX) ? path.slice(SCRATCH_PREFIX.length) : path;
}

/** Cuts a UTF-8 buffer to at most `max` bytes without splitting a character. */
export function utf8Slice(bytes: Uint8Array, max: number): string {
  let end = Math.min(bytes.length, max);
  if (end < bytes.length) while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  return Buffer.from(bytes.buffer, bytes.byteOffset, end).toString('utf8');
}

const reason = (cause: unknown) =>
  (cause as NodeJS.ErrnoException | undefined)?.code ?? String(cause).slice(0, 200);

/**
 * Removes an experiment folder, its manifest last: while anything else is left the manifest stays, so
 * the experiment still reads as present and a later discard or sweep tries again. The reason when it
 * couldn't, else null.
 */
async function remove(dir: string): Promise<string | null> {
  try {
    for (const name of await readdir(dir)) {
      if (name !== MANIFEST_FILE) await rm(join(dir, name), { recursive: true, force: true });
    }
    await rm(dir, { recursive: true, force: true });
    return null;
  } catch (cause) {
    return reason(cause) === 'ENOENT' ? null : reason(cause); // already gone is removed
  }
}

/**
 * Sweeps a scratch root without a sandbox: what the jobs process runs at start
 * and hourly (expired experiments, folders without a valid manifest, tampered
 * manifests). The same as `ExperimentSandbox.sweep` on a sandbox over `root`.
 */
export function sweepExperiments(options: {
  readonly root: string;
  readonly clock?: Clock;
}): AsyncResult<{ readonly removed: readonly ExperimentId[] }> {
  return createExperimentFolders({ root: options.root, clock: options.clock ?? systemClock }).sweep();
}

export function createExperimentFolders(options: { root: string; clock: Clock }): ExperimentFolders {
  const { clock } = options;
  let rootReal: Promise<string> | undefined;
  const root = () =>
    (rootReal ??= mkdir(options.root, { recursive: true }).then(() => realpath(options.root)));

  const folderOf = async (id: ExperimentId) => join(await root(), id);

  async function readManifest(id: ExperimentId): Promise<{ manifest: Manifest; dir: string } | null> {
    if (!isId(id)) return null;
    const dir = await folderOf(id);
    try {
      const parsed = manifestSchema.safeParse(JSON.parse(await readFile(join(dir, MANIFEST_FILE), 'utf8')));
      if (!parsed.success || parsed.data.id !== id) return null;
      return { manifest: parsed.data, dir: await realpath(dir) };
    } catch {
      return null;
    }
  }

  const live = (manifest: Manifest) => manifest.expiresAt > clock.now();

  async function find(id: ExperimentId): AsyncResult<{ manifest: Manifest; dir: string }> {
    const found = await readManifest(id);
    if (!found || !live(found.manifest) || !isInside(await root(), found.dir))
      return err(SandboxExperimentNotFound());
    return ok(found);
  }

  async function writeManifest(dir: string, manifest: Manifest): Promise<void> {
    await writeFile(join(dir, MANIFEST_FILE), `${JSON.stringify(manifest)}\n`);
  }

  async function touch(id: ExperimentId): AsyncResult<Experiment> {
    const found = await find(id);
    if (!found.ok) return found;
    const manifest = { ...found.value.manifest, expiresAt: clock.now() + found.value.manifest.ttlMs };
    await writeManifest(found.value.dir, manifest);
    return ok(toExperiment(manifest, found.value.dir));
  }

  return {
    root,
    async open({ id, projectId, purpose, ttlMs = DEFAULT_EXPERIMENT_TTL_MS }) {
      if (!isId(id)) return err(SandboxExperimentNotFound(undefined, { detail: 'not a ULID' }));
      const existing = await readManifest(id);
      if (existing && live(existing.manifest)) return touch(id);
      const dir = await folderOf(id);
      // An expired or broken folder with this id is stale: start it again.
      await rm(dir, { recursive: true, force: true });
      await mkdir(join(dir, TMP_DIR), { recursive: true });
      const now = clock.now();
      const ttl = Math.min(Math.max(1, Math.round(ttlMs)), MAX_TTL_MS);
      const manifest: Manifest = {
        version: 1,
        id,
        projectId,
        purpose,
        createdAt: now,
        expiresAt: now + ttl,
        ttlMs: ttl,
      };
      const real = await realpath(dir);
      await writeManifest(real, manifest);
      return ok(toExperiment(manifest, real));
    },
    async get(id) {
      const found = await find(id);
      return found.ok ? ok(toExperiment(found.value.manifest, found.value.dir)) : found;
    },
    touch,
    async list(id, dir = '') {
      const found = await touch(id);
      if (!found.ok) return found;
      const rel = stripScratch(dir).replace(/\/+$/, '');
      const base = rel === '' ? found.value.dir : await resolveInside(found.value.dir, rel);
      if (base === null) return err(SandboxPathOutside(undefined, { detail: `list ${rel}` }));
      const files = await walkFiles(base, MAX_LISTING);
      const prefix = rel === '' ? '' : `${rel}/`;
      const listing: SandboxFile[] = [];
      const dirs = new Set<string>();
      for (const [path, stamp] of files) {
        const full = `${prefix}${path}`;
        if (full === MANIFEST_FILE || full === COOKIES_FILE || full.startsWith(`${TMP_DIR}/`)) continue;
        listing.push({ path: full, bytes: stamp.bytes, kind: 'file' });
        const parts = full.split('/');
        for (let i = 1; i < parts.length; i++) {
          const folder = parts.slice(0, i).join('/');
          if (folder.startsWith(prefix)) dirs.add(folder);
        }
      }
      for (const path of dirs) listing.push({ path, bytes: 0, kind: 'directory' });
      return ok(listing.sort((a, b) => a.path.localeCompare(b.path)));
    },
    async readText(id, path, maxBytes = DEFAULT_READ_BYTES) {
      const found = await touch(id);
      if (!found.ok) return found;
      const full = await resolveInside(found.value.dir, stripScratch(path));
      if (full === null) return err(SandboxPathOutside(undefined, { detail: `read ${path}` }));
      const limit = Math.max(0, Math.min(Math.floor(maxBytes), DEFAULT_READ_BYTES));
      let handle;
      try {
        handle = await openFile(full, 'r');
        const buffer = new Uint8Array(limit + 4);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return ok(utf8Slice(buffer.subarray(0, bytesRead), limit));
      } catch {
        return err(SandboxPathOutside(undefined, { detail: `unreadable ${path}` }));
      } finally {
        await handle?.close();
      }
    },
    async discard(id) {
      const found = await readManifest(id);
      if (!found) return err(SandboxExperimentNotFound());
      if (!isInside(await root(), found.dir) || found.dir === (await root()))
        return err(SandboxPathOutside(undefined, { detail: 'experiment outside the scratch root' }));
      const freedBytes = await folderBytes(found.dir);
      const removed = await remove(found.dir);
      return removed === null
        ? ok({ freedBytes })
        : err(SandboxDiscardFailed(undefined, { detail: removed }));
    },
    async sweep() {
      let base: string;
      let entries: Dirent[];
      try {
        base = await root();
        entries = await readdir(base, { withFileTypes: true });
      } catch (cause) {
        return err(SandboxDiscardFailed(undefined, { detail: `sweep: ${reason(cause)}` }));
      }
      const removed: ExperimentId[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const id = entry.name as ExperimentId;
        const found = await readManifest(id);
        if (found && live(found.manifest) && found.manifest.expiresAt - clock.now() <= MAX_TTL_MS) continue;
        // One folder the disk won't let go of doesn't stop the rest; the next sweep tries it again.
        if ((await remove(join(base, entry.name))) === null && isId(id)) removed.push(id);
      }
      return ok({ removed });
    },
  };
}
