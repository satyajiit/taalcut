// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `library.relinkLocations` applies verified "find missing files" candidates
 * (ADR 0001, user gesture); its inverse, the internal
 * `library.restoreLocations`, puts the locations back as they were. The job
 * verified BLAKE3, so the handler re-checks only what can change cheaply:
 * the size and the partial hash (`library.relink_mismatch`).
 */
import { basename, relative, sep } from 'node:path';
import { stat } from 'node:fs/promises';
import {
  defineCommand,
  err,
  LIBRARY_COMMANDS,
  libraryCommandPayloads,
  NotFoundError,
  ok,
  type AssetId,
  type CommandContext,
  type CommandHandler,
  type CommitAnnouncer,
  type Result,
  type SourceId,
} from '@taalcut/core';
import { eq } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import type { ContentHasher } from '../hashing/content-hasher';
import type { AssetLocationId } from '../ids';
import type { StagedWrite } from '../ports/unit-of-work';
import { normaliseRelativePath } from '../repositories/asset-locations';
import { assetLocations, assets, sources, type LocationState } from '../schema/library';
import { RelinkMismatch } from './errors';
import { absolutePathOf } from './scan-store';

const C = LIBRARY_COMMANDS;
const P = libraryCommandPayloads;

interface RestoreItem {
  readonly locationId: AssetLocationId;
  readonly sourceId: SourceId;
  readonly relativePath: string;
  readonly state: LocationState;
}

export interface RelinkCommandDeps {
  readonly db: LibraryDatabase;
  readonly hasher: ContentHasher;
  readonly guard: <Pl, R>(handler: CommandHandler<Pl, R>) => CommandHandler<Pl, R>;
  readonly write: (context: CommandContext, change: StagedWrite) => Result<void> | Result<unknown>;
  readonly announcer?: Pick<CommitAnnouncer, 'note'>;
}

export function createRelinkCommands(deps: RelinkCommandDeps) {
  const { db } = deps;

  const locationWithAsset = (id: AssetLocationId) =>
    db.orm
      .select({ location: assetLocations, asset: assets })
      .from(assetLocations)
      .innerJoin(assets, eq(assets.id, assetLocations.assetId))
      .where(eq(assetLocations.id, id))
      .get();

  /** The watched source whose folder holds `path`, the location's own first, else the deepest. */
  const sourceFor = (path: string, preferred: SourceId) => {
    const holding = db.orm
      .select()
      .from(sources)
      .all()
      .filter((s) => path.startsWith(s.rootPath.endsWith(sep) ? s.rootPath : s.rootPath + sep))
      .sort((a, b) => b.rootPath.length - a.rootPath.length);
    return holding.find((s) => s.id === preferred) ?? holding[0];
  };

  const setLocation = (item: RestoreItem, rootPath: string, via?: 'relink') =>
    db.orm
      .update(assetLocations)
      .set({
        sourceId: item.sourceId,
        relativePath: item.relativePath,
        absolutePathCached: absolutePathOf(rootPath, item.relativePath),
        state: item.state,
        ...(item.state === 'present' ? { missingSince: null } : {}),
        ...(via ? { via } : {}),
      })
      .where(eq(assetLocations.id, item.locationId))
      .run();

  const relinkLocations = defineCommand({
    name: C.relinkLocations,
    payload: P[C.relinkLocations],
    sideEffect: 'write',
    handle: deps.guard(async (payload, context) => {
      const before: RestoreItem[] = [];
      const after: { item: RestoreItem; rootPath: string; assetId: AssetId }[] = [];
      for (const item of payload.items) {
        const row = locationWithAsset(item.locationId as AssetLocationId);
        if (!row) return err(NotFoundError({ entity: 'asset_location', id: item.locationId }));
        const name = row.asset.originalFilename;
        const mismatch = (detail: string) => err(RelinkMismatch({ name }, { detail }));
        if (row.asset.contentHash !== item.contentHash) return mismatch('not the asset’s bytes');
        const info = await stat(item.path).catch(() => undefined);
        if (!info?.isFile() || info.size !== row.asset.sizeBytes) return mismatch('size changed');
        const expected = row.location.partialHash ?? row.asset.partialHash;
        if (expected) {
          const partial = await deps.hasher.partial(item.path);
          if (!partial.ok || partial.value !== expected) return mismatch('partial hash changed');
        }
        const source = sourceFor(item.path, row.location.sourceId);
        if (!source) return mismatch('outside every source folder');
        const relativePath = normaliseRelativePath(
          relative(source.rootPath, item.path).split(sep).join('/').normalize('NFC'),
        );
        if (!relativePath.ok) return mismatch('outside every source folder');
        before.push({
          locationId: row.location.id,
          sourceId: row.location.sourceId,
          relativePath: row.location.relativePath,
          state: row.location.state,
        });
        after.push({
          item: {
            locationId: row.location.id,
            sourceId: source.id,
            relativePath: relativePath.value,
            state: 'present',
          },
          rootPath: source.rootPath,
          assetId: row.asset.id,
        });
      }
      const staged = deps.write(context, () => {
        for (const { item, rootPath } of after) setLocation(item, rootPath, 'relink');
        return ok(undefined);
      });
      if (!staged.ok) return staged;
      const assetIds = [...new Set(after.map((a) => a.assetId))];
      if (assetIds.length > 0) {
        deps.announcer?.note(context, { projectId: null, entity: 'asset', change: 'updated', ids: assetIds });
      }
      return ok({
        result: {
          relinked: after.map((a) => a.item.locationId),
          names: after.map((a) => basename(a.item.relativePath)),
        },
        inverse: { name: C.restoreLocations, payload: { items: before } },
      });
    }),
  });

  const restoreLocations = defineCommand({
    name: C.restoreLocations,
    payload: P[C.restoreLocations],
    sideEffect: 'write',
    internal: true,
    handle: deps.guard(async (payload, context) => {
      const roots = new Map(
        db.orm
          .select()
          .from(sources)
          .all()
          .map((s) => [s.id as string, s.rootPath]),
      );
      const assetIds: AssetId[] = [];
      for (const item of payload.items) {
        if (!roots.has(item.sourceId)) return err(NotFoundError({ entity: 'source', id: item.sourceId }));
        const row = locationWithAsset(item.locationId as AssetLocationId);
        if (row) assetIds.push(row.asset.id);
      }
      const staged = deps.write(context, () => {
        for (const item of payload.items) setLocation(item as RestoreItem, roots.get(item.sourceId)!);
        return ok(undefined);
      });
      if (!staged.ok) return staged;
      const uniqueAssetIds = [...new Set(assetIds)];
      if (uniqueAssetIds.length > 0) {
        deps.announcer?.note(context, {
          projectId: null,
          entity: 'asset',
          change: 'updated',
          ids: uniqueAssetIds,
        });
      }
      return ok({ result: { restored: payload.items.map((i) => i.locationId) } });
    }),
  });

  return { relinkLocations, restoreLocations };
}
