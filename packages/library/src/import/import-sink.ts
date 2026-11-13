// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library side of the Wi-Fi and USB hand-offs (P2-L3, P3-B4/P3-B5, lan
 * process): core's ImportSink, with `knownAssets` for USB "Only new". Staging is `<originals root>/.incoming/`, on the root's own
 * volume, so the final move is a rename. `importStaged` is idempotent per
 * upload: the chosen destination is written to `<uploadId>.dest` before the
 * rename, so a re-run after a crash between the rename and the commit finds
 * the file; the outcome is kept in `<uploadId>.done.json` (swept after 7
 * days), so a re-run after success returns it again. The journal and the
 * upload's companions are deleted last.
 */
import { mkdir, open, readFile, rm, stat, statfs } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import {
  err,
  ok,
  newId,
  toTaalcutError,
  ValidationError,
  type AsyncResult,
  type EventBus,
  type ImportOutcome,
  type ImportSink,
  type StagedImport,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { fsyncPath, moveFile, writeDurably } from '../files/durable-files';
import { createWasmContentHasher, type ContentHasher } from '../hashing/content-hasher';
import { inTransaction } from '../repositories/shared';
import { fileFacts } from '../sources/scan-plan';
import type { VolumeProbe } from '../sources/volumes';
import { OriginalsOffline } from './errors';
import { datedFolder, freeName, sanitiseFileName } from './file-names';
import { duplicateOf, recordImport, sessionSource } from './import-record';
import { bindImportSpace, type ImportSinkSpaceCoordinator } from './space';
import { knownAssets, presentFile } from './known-assets';
import { createImportReaderRegistry } from './local/readers';

export interface ImportSinkOptions {
  readonly space?: ImportSinkSpaceCoordinator;
  /** The managed originals root: a path, or a function reading the setting each time. */
  readonly originalsRoot: string | (() => Promise<string>);
  readonly events?: Pick<EventBus, 'emit'>;
  readonly hasher?: ContentHasher;
  readonly volumes?: VolumeProbe;
}

export const STAGING_FOLDER = '.incoming';

/** The library's sink always answers `knownAssets` (core keeps it optional for other implementations). */
export type LibraryImportSink = ImportSink & Required<Pick<ImportSink, 'knownAssets'>>;

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/**
 * A journal a crash must find, rewritten in place: its fixed temp name is one the staging sweep leaves alone. The
 * folder is fsynced after the rename, before anything relies on the name (the staged bytes leave right after the
 * dest journal): a power loss could otherwise keep the move and lose the journal (Phase 3 review M11).
 */
async function writeJournal(path: string, text: string): Promise<void> {
  await writeDurably(path, text, `${path}.tmp`);
  await fsyncPath(dirname(path));
}

async function chooseDestination(root: string, file: StagedImport): Promise<string> {
  const folder = join(root, datedFolder(file.receivedAt));
  await mkdir(folder, { recursive: true });
  for (;;) {
    const destination = join(folder, await freeName(folder, sanitiseFileName(file.fileName)));
    try {
      // Different processes may select the same free name; only this upload may replace its reservation.
      const reservation = await open(destination, 'wx');
      await reservation.close();
      return destination;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
    }
  }
}

export function createImportSink(db: LibraryDatabase, options: ImportSinkOptions): LibraryImportSink {
  const readers = createImportReaderRegistry(db);
  const hasher = options.hasher ?? createWasmContentHasher();
  const rootOf = async () =>
    typeof options.originalsRoot === 'string' ? options.originalsRoot : options.originalsRoot();

  async function retainDestination(owner: string): AsyncResult<() => void> {
    try {
      const root = await rootOf();
      const volume =
        (await options.volumes?.identify(root)) ?? (await options.volumes?.identify(dirname(root)));
      return readers.acquire(`destination:${owner}:${newId<'ImportReader'>()}`, volume?.uuid ?? root);
    } catch (cause) {
      return err(toTaalcutError(cause));
    }
  }

  /** The staging folder, made on demand; `library.originals_offline` when the root's drive is gone. */
  async function stagingDir(): AsyncResult<{ root: string; dir: string }> {
    const root = await rootOf();
    const drive = /^\/Volumes\/[^/]+/.exec(root)?.[0];
    if (drive && !(await exists(drive))) return err(OriginalsOffline({ name: basename(drive) }));
    const dir = join(root, STAGING_FOLDER);
    try {
      await mkdir(dir, { recursive: true });
      return ok({ root, dir });
    } catch (cause) {
      return err(toTaalcutError(cause));
    }
  }

  const cleanUp = async (dir: string, file: StagedImport, extra: readonly string[] = []) => {
    const paths = [
      ...extra,
      join(dir, `${file.uploadId}.import.json`),
      ...file.companions,
      join(dir, `${file.uploadId}.dest`),
    ];
    for (const path of paths) await rm(path, { force: true });
  };

  async function importStaged(file: StagedImport, signal?: AbortSignal): AsyncResult<ImportOutcome> {
    const staging = await stagingDir();
    if (!staging.ok) return staging;
    const { root, dir } = staging.value;
    if (dirname(file.path) !== dir || file.companions.some((c) => dirname(c) !== dir)) {
      return err(ValidationError({ field: 'path' }, { detail: 'outside the staging folder' }));
    }
    const destJournal = join(dir, `${file.uploadId}.dest`);
    const stagedHere = await exists(file.path);
    const doneMarker = join(dir, `${file.uploadId}.done.json`);
    const done = await readFile(doneMarker, 'utf8').catch(() => undefined);
    if (done !== undefined) {
      const outcome = JSON.parse(done) as ImportOutcome;
      const asset = db.driver
        .prepare('SELECT content_hash FROM assets WHERE id=? AND trashed_at IS NULL')
        .get(outcome.assetId);
      const copy = typeof asset?.content_hash === 'string' ? duplicateOf(db, asset.content_hash) : undefined;
      const hash =
        copy?.managedPath && (await presentFile(copy.managedPath, file.sizeBytes))
          ? await hasher.full(copy.managedPath, signal ? { signal } : {})
          : null;
      if (hash?.ok && hash.value === asset?.content_hash) {
        await cleanUp(dir, file, stagedHere ? [file.path] : []);
        return ok(outcome);
      }
      // The receipt alone cannot discard a replacement upload after its saved original was lost.
      await rm(doneMarker, { force: true });
      if (stagedHere) await rm(destJournal, { force: true });
    }

    // A destination chosen before a crash is reused: the file may already be there.
    const journalled = await readFile(destJournal, 'utf8').catch(() => undefined);
    const bytes = stagedHere ? file.path : journalled && (await exists(journalled)) ? journalled : undefined;
    if (!bytes) return err(ValidationError({ field: 'path' }, { detail: 'the staged file is gone' }));

    const hashOptions = signal ? { signal } : {};
    const [full, partial] = [await hasher.full(bytes, hashOptions), await hasher.partial(bytes, hashOptions)];
    if (!full.ok) return full;
    if (!partial.ok) return partial;
    let duplicate = duplicateOf(db, full.value);
    if (duplicate?.managedPath && duplicate.managedPath !== bytes) {
      const managed = (await presentFile(duplicate.managedPath, file.sizeBytes))
        ? await hasher.full(duplicate.managedPath, hashOptions)
        : null;
      if (!managed?.ok || managed.value !== full.value) duplicate = { ...duplicate, managedPath: null };
    } else if (duplicate?.managedPath === '') duplicate = { ...duplicate, managedPath: null };
    const volume = await options.volumes?.identify(root);
    const volumeInfo = { uuid: volume?.uuid ?? null, name: volume?.name ?? null };

    let outcome: ImportOutcome;
    if (duplicate && duplicate.managedPath === bytes) {
      // Committed just before a crash: this upload's own managed copy, nothing left to write.
      const source = inTransaction(db, 'source', () =>
        ok(sessionSource(db, { file, root, volume: volumeInfo })),
      );
      if (!source.ok) return source;
      outcome = { assetId: duplicate.assetId, sourceId: source.value, duplicate: 'none' };
    } else {
      let destination = bytes;
      if (stagedHere && (!duplicate || duplicate.managedPath === null)) {
        const prior = journalled ? await stat(journalled).catch(() => null) : null;
        const priorHash =
          journalled && prior?.isFile() && prior.size > 0 ? await hasher.full(journalled, hashOptions) : null;
        const sameBytes = priorHash?.ok && priorHash.value === full.value;
        // The journal may outlive its file. Never overwrite unrelated bytes that later occupy that name.
        const reserved = prior?.isFile() && prior.size === 0;
        destination =
          journalled && (sameBytes || reserved) ? journalled : await chooseDestination(root, file);
        await writeJournal(destJournal, destination);
        if (!sameBytes) await moveFile(file.path, destination);
        await fsyncPath(dirname(destination));
      }
      const record = {
        file,
        root,
        relativePath: relative(root, destination).split(sep).join('/').normalize('NFC'),
        absolutePath: destination,
        facts: fileFacts(await stat(destination)),
        contentHash: full.value,
        partialHash: partial.value,
        volume: volumeInfo,
      };
      const recorded = inTransaction(db, 'asset', () => ok(recordImport(db, record, duplicate)));
      if (!recorded.ok) return recorded;
      outcome = recorded.value;
    }

    // A copy the library already manages: these bytes aren't kept.
    const extra = [
      ...(stagedHere ? [file.path] : []),
      ...(outcome.duplicate === 'already-in-library' ? [bytes] : []),
    ];
    options.events?.emit('library.changed', {
      projectId: null,
      entity: 'asset',
      change: outcome.duplicate === 'none' ? 'created' : 'updated',
      ids: [outcome.assetId],
    });
    await writeJournal(doneMarker, JSON.stringify(outcome));
    await cleanUp(dir, file, extra);
    return ok(outcome);
  }

  const space = options.space
    ? bindImportSpace(options.space, async () => {
        const place = await stagingDir();
        if (!place.ok) return place;
        const volume = await options.volumes?.identify(place.value.root);
        return ok({ volume: volume?.uuid ?? place.value.root, dir: place.value.dir });
      })
    : undefined;
  return {
    retainDestination,
    ...(space ? { space } : {}),
    async staging() {
      const staging = await stagingDir();
      if (!staging.ok) return staging;
      const { dir, root } = staging.value;
      const space = await statfs(dir).catch(() => undefined);
      const volume = await options.volumes?.identify(root);
      return ok({
        dir,
        freeBytes: space
          ? Math.max(
              0,
              Number(space.bavail) * Number(space.bsize) -
                (options.space?.reserved(volume?.uuid ?? root) ?? 0),
            )
          : 0,
        volumeName: volume?.name ?? null,
      });
    },
    importStaged: async (file, importOptions = {}) => {
      const retained = await retainDestination(file.uploadId);
      if (!retained.ok) return retained;
      try {
        return await importStaged(file, importOptions.signal);
      } catch (cause) {
        return err(toTaalcutError(cause));
      } finally {
        retained.value();
      }
    },
    knownAssets: async (ids) => {
      try {
        return ok(await knownAssets(db, ids));
      } catch (cause) {
        return err(toTaalcutError(cause));
      }
    },
  };
}
