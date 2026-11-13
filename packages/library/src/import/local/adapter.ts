// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { realpath, stat, statfs } from 'node:fs/promises';
import { basename, dirname, relative } from 'node:path';
import {
  CancelledError,
  err,
  newId,
  ok,
  toTaalcutError,
  type AsyncResult,
  type TransferSessionId,
} from '@taalcut/core';
import type { LibraryDatabase } from '../../db/database';
import type { ImportAdapter, PreparedImport, PreparedImportItem } from '../../imports/adapter';
import { groupMediaCaptures, type MediaCapturePlan, type CaptureFile } from './camera-profiles';
import { inventoryLocalMedia, openSelectedOriginal } from './inventory';
import { runLocalImport } from './run';
import type { LocalImportAdapterDeps, LocalImportData, LocalImportLocator } from './types';
import { createImportReaderRegistry } from './readers';
import { knownLocalCapture } from './receipts';

export type { LocalImportAdapterDeps } from './types';

async function preparedItem(
  db: LibraryDatabase,
  capture: MediaCapturePlan,
  source: Pick<LocalImportLocator, 'sourceVolume' | 'sourceMount'>,
  thumbnailUrl?: (id: string) => string,
): Promise<PreparedImportItem> {
  const first = capture.files[0]!;
  const duplicate = await knownLocalCapture(db, capture, source);
  const id = newId<'ImportItem'>();
  const captureId = newId<'CaptureGroup'>();
  return {
    item: {
      id,
      name: first.name,
      sizeBytes: capture.files.reduce((total, file) => total + file.sizeBytes, 0),
      capturedAt: Math.round(first.modifiedAt),
      thumbnailUrl: thumbnailUrl?.(id) ?? null,
      duplicate,
      captureId,
      required: true,
      supported: true,
      warning: capture.warnings[0] ?? null,
    },
    locator: {
      capture,
      captureId,
      uploadIds: Object.fromEntries(capture.files.map((file) => [file.name, newId<'TransferUpload'>()])),
    } satisfies LocalImportLocator,
  };
}

export function createLocalImportAdapter(deps: LocalImportAdapterDeps): ImportAdapter {
  return {
    capabilities: { pause: true, resume: true, cancel: true, retryFailed: true, byteResume: false },
    safeToDisconnect(_draft, privateData) {
      const data = privateData as LocalImportData;
      const readers = createImportReaderRegistry(deps.db);
      return (data.sourceVolumes ?? [data.volume]).every((volume) => readers.count(volume) === 0);
    },
    includes(draft, selected, privateData) {
      if (draft.method !== 'folder' || draft.recursive) return true;
      const data = privateData as LocalImportData;
      const file = (selected.locator as LocalImportLocator).capture.files[0]!;
      const root = data.roots.find((path) => file.path.startsWith(`${path}/`)) ?? dirname(file.path);
      return !relative(root, file.path).includes('/');
    },
    async prepare(input): AsyncResult<PreparedImport> {
      try {
        const chosen = input.paths ? ok(input.paths) : await deps.pick(input);
        if (!chosen.ok) return chosen;
        if (!chosen.value.length) return err(CancelledError());
        const inventory = await inventoryLocalMedia(chosen.value);
        if (!inventory.ok) return inventory;
        const root = await deps.originalsRoot();
        const sourceRoot = (await stat(chosen.value[0]!)).isDirectory()
          ? chosen.value[0]!
          : dirname(chosen.value[0]!);
        const roots = await Promise.all(chosen.value.map((path) => realpath(path)));
        const sourceInfo = await Promise.all(
          roots.map(async (path) => ({
            path,
            volume: await deps.volumes.identify(path),
          })),
        );
        const volume = sourceInfo[0]?.volume;
        const files: CaptureFile[] = [];
        for (const file of inventory.value.files) {
          const evidence = /\.insv$/i.test(file.name) ? await deps.inspectCapture?.(file) : undefined;
          files.push(evidence ? { ...file, evidence } : file);
        }
        const captures = groupMediaCaptures(files);
        const data: LocalImportData = {
          root,
          roots,
          sourceRoot,
          volume: volume?.uuid ?? sourceRoot,
          removable: sourceInfo.some(({ path, volume }) =>
            (volume?.mountPoint ?? path).startsWith('/Volumes/'),
          ),
          sourceVolumes: [...new Set(sourceInfo.map(({ path, volume }) => volume?.uuid ?? path))],
          transferSessionId: newId<'TransferSession'>() as TransferSessionId,
        };
        const items: PreparedImportItem[] = [];
        for (const capture of captures) {
          const source = sourceInfo.find(
            ({ path }) => capture.files[0]!.path === path || capture.files[0]!.path.startsWith(`${path}/`),
          );
          const identity = {
            sourceVolume: source?.volume?.uuid ?? source?.path ?? sourceRoot,
            sourceMount: source?.volume?.mountPoint ?? source?.path ?? sourceRoot,
          };
          const item = await preparedItem(deps.db, capture, identity, deps.thumbnailUrl);
          items.push({
            ...item,
            locator: {
              ...(item.locator as LocalImportLocator),
              ...identity,
            },
          });
        }
        return ok({
          sourceLabel: basename(sourceRoot),
          destinationLabel: root,
          items,
          privateData: data,
          selectAll: input.method === 'files' || input.method === 'folder',
        });
      } catch (cause) {
        return err(toTaalcutError(cause));
      }
    },
    async preflight(draft, items, privateData) {
      const data = privateData as LocalImportData;
      const missingRequired: string[] = [];
      const warnings = new Set<string>();
      let canStart = items.length > 0 || draft.watch;
      let knownBytes = 0;
      let selectedItems = 0;
      for (const selected of items) {
        const { capture } = selected.locator as LocalImportLocator;

        selectedItems += capture.files.length;
        missingRequired.push(...capture.missingNames);
        for (const warning of capture.warnings) warnings.add(warning);
        for (const file of capture.files) {
          knownBytes += file.sizeBytes;
          const opened = await openSelectedOriginal(file);
          if (opened.ok) await opened.value.close();
          else {
            canStart = false;
            warnings.add('source-changed');
          }
        }
      }
      if (draft.storage === 'reference' && data.removable && !draft.watch) {
        canStart = false;
        warnings.add('reference-removable');
      }
      if (
        draft.storage === 'reference' &&
        items.some((item) => (item.locator as LocalImportLocator).capture.disposition === 'archive')
      ) {
        canStart = false;
        warnings.add('archive-requires-copy');
      }
      const space = await statfs(data.root).catch(() => null);
      const availableBytes = space ? Number(space.bavail) * Number(space.bsize) : null;
      if (
        draft.storage === 'copy' &&
        availableBytes !== null &&
        knownBytes + 64 * 1024 * 1024 > availableBytes
      ) {
        canStart = false;
        warnings.add('insufficient-space');
      }
      return ok({
        canStart: canStart && (selectedItems > 0 || draft.watch),
        selectedItems,
        availableBytes,
        missingRequired,
        knownBytes,
        selectedCaptures: items.length,
        warnings: [...warnings],
      });
    },
    run: (context) => runLocalImport(deps, context),
  };
}
