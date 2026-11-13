// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import {
  defineCommand,
  coverExportPayloadSchema,
  err,
  NotImplementedError,
  ok,
  type ExportFileSink,
  type GeneratedAssetSink,
  type RenderWorker,
} from '@taalcut/core';
import type { TimelineAccess } from '../ports';

export function createCoverExportCommand(deps: {
  worker: RenderWorker;
  files: ExportFileSink;
  timelines: TimelineAccess;
  generatedAssets?: GeneratedAssetSink;
  clock?: { now(): number };
}) {
  return defineCommand({
    name: 'render.exportCover',
    payload: coverExportPayloadSchema,
    sideEffect: 'write',
    handle: async (input) => {
      if (!deps.worker.coverImage || !deps.files.writeBytes)
        return err(NotImplementedError({ feature: 'cover.export' }));
      const captured = await deps.worker.coverImage(input);
      if (!captured.ok) return captured;
      const timeline = await deps.timelines.get(input.timelineId);
      if (!timeline.ok) return timeline;
      const cover = input.aspect
        ? timeline.value.covers?.find((item) => item.aspect === input.aspect)
        : timeline.value.covers?.at(-1);
      const model = cover?.design
        ? 'designed-cover'
        : cover?.source.kind === 'asset'
          ? 'image-cover'
          : 'source-frame-cover';
      const bytes = Buffer.from(captured.value.dataBase64, 'base64');
      const registered = deps.generatedAssets
        ? await deps.generatedAssets.put({
            bytes,
            mediaType: 'image/jpeg',
            fileName: `cover-${input.timelineId}-${captured.value.revision}.jpg`,
            projectId: input.projectId,
            provenance: {
              kind: 'generated',
              generation: 'workspace',
              provider: 'taalcut',
              model,
              access: 'local',
              quality: null,
              promptSha256: createHash('sha256').update(bytes).digest('hex'),
              voiceId: null,
              providerRef: null,
              c2pa: 'absent',
              costUsd: 0,
              runId: null,
              createdAt: deps.clock?.now() ?? Date.now(),
            },
          })
        : null;
      if (registered && !registered.ok) return registered;
      const file = await deps.files.writeBytes({
        projectId: input.projectId,
        baseName: `${timeline.value.name} cover`,
        extension: '.jpg',
        bytes,
      });
      return file.ok
        ? ok({
            result: {
              ...file.value,
              ...(registered?.ok ? { assetId: registered.value.assetId } : {}),
              width: captured.value.width,
              height: captured.value.height,
              revision: captured.value.revision,
            },
          })
        : file;
    },
  });
}
