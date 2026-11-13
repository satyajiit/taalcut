// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The installed-components registry: registry.json in the components folder.
 * It is the source of truth for "installed": a folder under installed/ that
 * the registry does not point to is debris from a crash and gets swept.
 * Every change is a full atomic rewrite, one at a time.
 */
import { existsSync, readFileSync } from 'node:fs';
import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createSerialQueue } from '@taalcut/core';
import { z } from 'zod';
import { isErrnoException, writeFileAtomic } from './fs-util';
import { ComponentLicenceSchema } from './manifest';

const InstalledEntrySchema = z.object({
  id: z.string(),
  version: z.string(),
  sha256: z.string(),
  platform: z.string(),
  /** Relative to the components folder, '/' separators. */
  dir: z.string(),
  /** File name inside `dir` for single-file components. */
  file: z.string().optional(),
  /** Size of the installed files. */
  bytes: z.int().nonnegative(),
  installedAt: z.string(),
  /** The manifest's licence for the installed version, its pinned NOTICE.txt included. */
  licence: ComponentLicenceSchema,
  /** File name inside `dir` of the licence notice saved at install, verified against `licence.notice`. */
  notice: z.string().min(1),
});

const RegistryFileSchema = z.object({
  schemaVersion: z.literal(1),
  components: z.record(z.string(), InstalledEntrySchema),
});

export type InstalledEntry = z.infer<typeof InstalledEntrySchema>;

/**
 * An installed component's folder, read synchronously and read-only from
 * `<root>/registry.json` (writes are atomic renames, so a read sees a whole
 * file): for code that must answer inside a synchronous hook, such as a
 * module loader resolving a native binding. Undefined when the component
 * isn't installed, its folder is gone, or the registry is missing or
 * unreadable (the manager repairs that; this never writes).
 */
export function installedComponentDirSync(root: string, id: string): string | undefined {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
  } catch {
    return undefined;
  }
  const parsed = RegistryFileSchema.safeParse(json);
  const entry = parsed.success ? parsed.data.components[id] : undefined;
  if (!entry) return undefined;
  const dir = join(root, entry.dir);
  return existsSync(join(dir, entry.file ?? '')) ? dir : undefined;
}

export class InstalledRegistry {
  private readonly changes = createSerialQueue();

  private constructor(
    private readonly path: string,
    private entries: ReadonlyMap<string, InstalledEntry>,
  ) {}

  /**
   * Reads the registry. A missing file is an empty registry. A corrupt one is
   * moved aside (registry.json.corrupt-<time>) and treated as empty: the
   * components then reinstall on demand, which beats refusing to start.
   */
  static async load(path: string, now: () => number = Date.now): Promise<InstalledRegistry> {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (cause) {
      if (isErrnoException(cause, 'ENOENT')) return new InstalledRegistry(path, new Map());
      throw cause;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    const parsed = RegistryFileSchema.safeParse(json);
    if (!parsed.success) {
      await rename(path, `${path}.corrupt-${now()}`);
      return new InstalledRegistry(path, new Map());
    }
    return new InstalledRegistry(path, new Map(Object.entries(parsed.data.components)));
  }

  get(id: string): InstalledEntry | undefined {
    return this.entries.get(id);
  }

  list(): InstalledEntry[] {
    return [...this.entries.values()];
  }

  /** Adds or replaces an entry. Resolves once the new file is on disk. */
  put(entry: InstalledEntry): Promise<void> {
    return this.change((next) => {
      next.set(entry.id, entry);
    });
  }

  /** Removes an entry and returns it. */
  async delete(id: string): Promise<InstalledEntry | undefined> {
    let removed: InstalledEntry | undefined;
    await this.change((next) => {
      removed = next.get(id);
      next.delete(id);
    });
    return removed;
  }

  /** Resolves once every change asked so far is on disk (or has failed): nothing of it writes after. */
  settled(): Promise<void> {
    return this.changes.settled();
  }

  private change(edit: (next: Map<string, InstalledEntry>) => void): Promise<void> {
    const run = async () => {
      const next = new Map(this.entries);
      edit(next);
      const file = { schemaVersion: 1 as const, components: Object.fromEntries(next) };
      await writeFileAtomic(this.path, `${JSON.stringify(file, null, 2)}\n`);
      this.entries = next;
    };
    return this.changes.run(run);
  }
}
