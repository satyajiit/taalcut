// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1 tpl in the agent process: what render's `designTemplateCompositions` needs from the app. The Designer works
 * in the workspace of the project the reel became a template in; a kept composition's files are copied from there
 * into the templates' pool (WorkspaceStore.putTemplateBlob), since the project may go and the template stays. The
 * vision judge's stills are drawn by the render worker over the reel's own frame (`workspaceFrames`, over an
 * image), and judged by the same model the design calls use. The reel's frames are cut from the template's kept
 * reel with the app's FFmpeg.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  err,
  NotImplementedError,
  ok,
  type AsyncResult,
  type GraphicComposition,
  type ProjectId,
  type RenderWorker,
  type WorkspaceStore,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import {
  reelFrames,
  visionJudge,
  type DesignOverlay,
  type DesignPicture,
  type DrawOver,
  type JudgeModel,
  type TemplateCompositionDeps,
} from '@taalcut/render';

/** Copies a composition's files from the project's workspace into the templates' pool. */
export function keepInPool(
  store: Pick<WorkspaceStore, 'readBlob' | 'putTemplateBlob'>,
  projectId: ProjectId,
) {
  return async (composition: GraphicComposition): AsyncResult<void> => {
    if (!store.putTemplateBlob) return err(NotImplementedError({ feature: 'templateBlobs' }));
    for (const file of composition.files) {
      const data = await store.readBlob(projectId, file.sha256);
      if (!data.ok) return data;
      const put = await store.putTemplateBlob(data.value);
      if (!put.ok) return put;
    }
    return ok(undefined);
  };
}

/** The render worker's stills of a composition over a picture (the reel's frame). */
export function drawOverWith(worker: RenderWorker, projectId: ProjectId): DrawOver {
  return async ({ composition, params, seconds, over }, signal) => {
    if (!worker.workspaceFrames) return err(NotImplementedError({ feature: 'workspaceFrames' }));
    const drawn = await worker.workspaceFrames(
      {
        projectId,
        entry: composition.entry,
        files: composition.files,
        params,
        seconds: [...seconds],
        over: { kind: 'image', mimeType: over.mimeType, dataBase64: over.data },
      },
      signal ? { signal } : {},
    );
    if (!drawn.ok) return drawn;
    return ok(
      drawn.value.frames.map((frame): DesignPicture => ({
        data: frame.dataBase64,
        mimeType: frame.mimeType,
      })),
    );
  };
}

export interface TemplateDesignWiring {
  readonly projectId: ProjectId;
  readonly design: DesignOverlay;
  readonly store: Pick<WorkspaceStore, 'readBlob' | 'putTemplateBlob'>;
  readonly worker: RenderWorker;
  readonly model: JudgeModel;
  readonly media: MediaContext;
  /** The template's kept reel, and a scratch folder for its frames. */
  readonly reel: string;
  readonly scratch: string;
  readonly signal?: AbortSignal;
}

/** Render's deps for one template's graphics. */
export function templateCompositionDeps(wiring: TemplateDesignWiring): TemplateCompositionDeps {
  const dir = join(wiring.scratch, 'template-design');
  return {
    projectId: wiring.projectId,
    design: wiring.design,
    reelFrames: async (brief) => {
      await mkdir(dir, { recursive: true });
      return reelFrames(wiring.media, dir, wiring.reel, brief);
    },
    drawOver: drawOverWith(wiring.worker, wiring.projectId),
    judge: visionJudge(wiring.model),
    keep: keepInPool(wiring.store, wiring.projectId),
    ...(wiring.signal ? { signal: wiring.signal } : {}),
  };
}
