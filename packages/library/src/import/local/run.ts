// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  CancelledError,
  err,
  ok,
  publicErrorSchema,
  toTaalcutError,
  type AsyncResult,
  type AssetId,
  type SourceId,
  type CaptureGroupId,
} from '@taalcut/core';
import type { ImportRunContext } from '../../imports/adapter';
import { createImportSink } from '../import-sink';
import type { LocalImportAdapterDeps, LocalImportData, LocalImportLocator } from './types';
import { archiveCapture } from './archive';
import { createImportReaderRegistry } from './readers';
import { referenceLocalFile } from './reference';
import { createImportSpaceCoordinator } from './space';
import { stageLocalAsset } from './staged';
import type { CaptureArchive } from './archive-types';
import { configureImportWatch } from './watch-source';
import { recordLocalImportReceipt } from './receipts';

export type { LocalImportData, LocalImportLocator } from './types';

export async function runLocalImport(
  deps: LocalImportAdapterDeps,
  context: ImportRunContext,
): AsyncResult<void> {
  const data = context.privateData as LocalImportData;
  const readers = createImportReaderRegistry(deps.db);
  const space = createImportSpaceCoordinator(deps.db);
  const sink = createImportSink(deps.db, {
    originalsRoot: data.root,
    volumes: deps.volumes,
    ...(deps.events ? { events: deps.events } : {}),
  });
  try {
    await mkdir(data.root, { recursive: true });
    const targetVolume = await deps.volumes.identify(data.root);
    const destinationVolume = targetVolume?.uuid ?? data.root;
    for (const volume of new Set([...(data.sourceVolumes ?? [data.volume]), destinationVolume])) {
      const lease = readers.acquire(context.session.id, volume);
      if (!lease.ok) return lease;
    }
    if (context.draft.watch)
      for (const root of data.roots) {
        const configured = await configureImportWatch(deps, root, context.draft.recursive);
        if (!configured.ok) return configured;
        context.source?.(configured.value);
      }
    for (const selected of context.items) {
      if (context.signal.aborted) return err(CancelledError());
      const locator = selected.locator as LocalImportLocator;

      const base = {
        itemId: selected.item.id,
        name: selected.item.name,
        receivedBytes: 0,
        result: null,
        error: null,
      };
      context.report({ ...base, state: 'receiving' });
      context.progress({ currentFile: selected.item.name });
      const copiedBytes = new Map<string, number>();
      const progress = (name: string, event: { bytes: number; stage: 'copying' | 'verifying' }) => {
        copiedBytes.set(name, Math.max(copiedBytes.get(name) ?? 0, event.bytes));
        context.report({
          ...base,
          receivedBytes: [...copiedBytes.values()].reduce((sum, bytes) => sum + bytes, 0),
          state: event.stage === 'copying' ? 'receiving' : 'checking',
        });
        context.progress({ currentFile: name });
      };
      let savedCapture: CaptureArchive | undefined;
      if (
        context.draft.storage === 'copy' &&
        (locator.capture.disposition === 'archive' ||
          locator.capture.profile !== 'generic' ||
          locator.capture.files.length > 1)
      ) {
        const archived = await archiveCapture(
          deps.db,
          {
            ...locator.capture,
            key: locator.sourceMount
              ? locator.capture.key.slice(locator.sourceMount.replace(/\/$/, '').length)
              : locator.capture.key,
          },
          {
            root: data.root,
            sourceKey: locator.sourceVolume ?? data.volume,
            signal: context.signal,
            progress,
            space,
            owner: context.session.id,
            volume: destinationVolume,
          },
        );
        if (!archived.ok) {
          context.report({ ...base, state: 'failed', error: publicErrorSchema.parse(archived.error) });
          continue;
        }
        savedCapture = archived.value;
        if (locator.capture.disposition === 'archive') {
          recordLocalImportReceipt(deps.db, locator, [], archived.value.id);
          context.report({
            ...base,
            state: 'archived',
            receivedBytes: selected.item.sizeBytes ?? 0,
            result: {
              kind: 'archived',
              captureId: archived.value.id as CaptureGroupId,
              complete: archived.value.completeness === 'complete',
            },
          });
          continue;
        }
      }
      let lastResult:
        | {
            assetId: AssetId;
            sourceId: SourceId;
            duplicate: boolean;
          }
        | undefined;
      let failed = false;
      const importedAssets: AssetId[] = [];
      for (const file of locator.capture.files) {
        if (locator.capture.optionalNames.includes(file.name)) continue;
        if (context.draft.storage === 'reference') {
          const referenced = await referenceLocalFile(
            deps,
            file,
            context.draft.watch,
            context.signal,
            context.draft.method === 'folder'
              ? (data.roots.find((root) => file.path.startsWith(`${root}/`)) ?? dirname(file.path))
              : undefined,
            context.draft.recursive,
          );
          if (!referenced.ok) {
            context.report({ ...base, state: 'failed', error: publicErrorSchema.parse(referenced.error) });
            failed = true;
            break;
          }
          lastResult = referenced.value;
          continue;
        }
        const imported = await stageLocalAsset({
          file,
          uploadId: locator.uploadIds[file.name]!,
          data,
          context,
          sink,
          space,
          destinationVolume,
          ...(savedCapture ? { archivePath: join(savedCapture.directory, file.name) } : {}),
          progress: (event) => progress(file.name, event),
        });
        if (!imported.ok) {
          context.report({ ...base, state: 'failed', error: publicErrorSchema.parse(imported.error) });
          failed = true;
          break;
        }
        lastResult = { ...imported.value, duplicate: imported.value.duplicate === 'already-in-library' };
        importedAssets.push(imported.value.assetId);
      }
      if (!failed && lastResult && context.draft.storage === 'copy')
        recordLocalImportReceipt(deps.db, locator, importedAssets, savedCapture?.id);
      if (!failed && lastResult)
        context.report({
          ...base,
          state: lastResult.duplicate ? 'duplicate' : 'imported',
          receivedBytes: context.draft.storage === 'reference' ? 0 : (selected.item.sizeBytes ?? 0),
          result: { kind: 'asset', assetId: lastResult.assetId, sourceId: lastResult.sourceId },
        });
      space.release(context.session.id);
    }
    return context.signal.aborted ? err(CancelledError()) : ok(undefined);
  } catch (cause) {
    return err(toTaalcutError(cause));
  } finally {
    space.release(context.session.id);
    readers.releaseOwner(context.session.id);
  }
}
