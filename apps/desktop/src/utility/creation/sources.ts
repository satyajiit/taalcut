// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import {
  CancelledError,
  err,
  EventBusToken,
  InterchangeMediaSourceToken,
  ok,
  RationalTime,
  ValidationError,
  type AssetId,
  type AsyncResult,
  type Container,
} from '@taalcut/core';
import { createRepositories, LibraryDatabaseToken } from '@taalcut/library';
import { extractFrame } from '@taalcut/media';
import type { CreationCapture, CreationSourceHost } from '@taalcut/tools';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { mediaBinaries } from '../roots/media-jobs';
import { captureCreationUrl, keepCreationImage } from './browser';
import { fetchCreationResource } from './network';
import { runManagedCreationProject } from './project-execution-host';
import { creationSnapshotRoot, snapshotCreationDirectory } from './source-snapshots';
import { creationImage } from './model';

async function readAsset(
  container: Container,
  config: UtilityConfig,
  assetId: AssetId,
  signal: AbortSignal,
): AsyncResult<CreationCapture> {
  if (signal.aborted) return err(CancelledError());
  const repos = createRepositories(container.resolve(LibraryDatabaseToken));
  const found = repos.assets.get(assetId);
  if (!found.ok) return found;
  const asset = found.value;
  const media = await container.resolve(InterchangeMediaSourceToken).resolve([assetId]);
  if (!media.ok) return media;
  const original = media.value.get(assetId);
  if (!original?.path)
    return err(ValidationError({ field: 'assetId' }, { detail: 'The reference asset is offline' }));
  const assets: CreationCapture['assets'][number][] = [];
  if (asset.kind === 'image') {
    // Reject unsupported/offline images during free source research, before reserving a model call.
    const image = await creationImage(container, assetId);
    if (!image.ok) return image;
    assets.push({ assetId, mimeType: image.value.mimeType, label: original.name });
  }
  if (asset.kind === 'video') {
    const binaries = await mediaBinaries(config).resolve();
    if (!binaries.ok) return binaries;
    const seconds =
      original.rate && original.durationFrames
        ? RationalTime.toSeconds(RationalTime.of(original.durationFrames, original.rate))
        : 1;
    for (const fraction of [0.1, 0.5, 0.9]) {
      const frame = await extractFrame(
        original.path,
        { value: Math.round(seconds * fraction * 1000), rate: 1000 },
        {
          binaries: binaries.value,
          onComputeFallback: (event) => container.resolve(EventBusToken).emit('compute.fallback', event),
        },
        { format: 'png', maxDimension: 1280, signal },
      );
      if (!frame.ok) return frame;
      const kept = await keepCreationImage(container, frame.value.data, 'reference-frame');
      if (!kept.ok) return kept;
      assets.push({
        assetId: kept.value,
        mimeType: 'image/png',
        label: `${original.name} at ${Math.round(seconds * fraction * 1000)}ms`,
      });
    }
  }
  return ok({
    title: original.name,
    url: `asset:${assetId}`,
    assets,
    text: JSON.stringify({
      id: assetId,
      kind: asset.kind,
      name: original.name,
      width: original.width,
      height: original.height,
      durationFrames: original.durationFrames,
      rate: original.rate,
    }),
    evidence: [assetId],
  });
}

export function creationSourceHost(container: Container, config: UtilityConfig): CreationSourceHost {
  const capture = (url: string, signal: AbortSignal) => captureCreationUrl(container, config, url, signal);
  return {
    readAsset: (id, signal) => readAsset(container, config, id, signal),
    captureUrl: capture,
    snapshotDirectory: (accessId, signal) => snapshotCreationDirectory(config.userData, accessId, signal),
    runProject: (request, signal) =>
      runManagedCreationProject({
        request,
        container,
        config,
        snapshotRoot: join(creationSnapshotRoot(config.userData), request.snapshotId, 'source'),
        capture: (url, signal) =>
          captureCreationUrl(container, config, url, signal, { localOrigin: new URL(url).origin }),
        signal,
      }),
    async request(url, options) {
      const response = await fetchCreationResource(url, {
        signal: options.signal,
        maxBytes: options.maxBytes,
      });
      return response.ok
        ? ok({ body: new TextDecoder().decode(response.value.bytes), finalUrl: response.value.url })
        : response;
    },
  };
}
