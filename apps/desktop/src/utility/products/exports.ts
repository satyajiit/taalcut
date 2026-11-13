// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  CommandBusToken,
  RenderStoreToken,
  RENDER_COMMANDS,
  err,
  ok,
  idSchema,
  ValidationError,
  type AsyncResult,
  type Container,
  type ProductCampaign,
  type ProductStore,
  type Timeline,
} from '@taalcut/core';
import { z } from 'zod';

const exported = z.object({ renderId: idSchema<'Render'>() });
export function productExportPresets(canvas: Pick<Timeline['canvas'], 'width' | 'height'>) {
  const { width, height } = canvas;
  return width === height
    ? (['square2160', 'square'] as const)
    : width * 5 === height * 4
      ? (['portrait2160', 'portrait'] as const)
      : width > height
        ? (['landscape4k', 'landscape'] as const)
        : (['master4k', 'reels'] as const);
}

/** Required outputs are pinned durably; queued jobs never count as a finished product video. */
export async function ensureProductRenders(
  container: Container,
  products: Pick<ProductStore, 'getCampaign' | 'saveCampaign'>,
  campaign: ProductCampaign,
  timelines: readonly Timeline[],
): AsyncResult<boolean> {
  const required = campaign.renders;
  if (!required?.length) {
    const renders: NonNullable<ProductCampaign['renders']> = [];
    for (const timeline of timelines) {
      for (const presetId of productExportPresets(timeline.canvas)) {
        const rendered = await container.resolve(CommandBusToken).dispatch(
          RENDER_COMMANDS.export,
          {
            projectId: campaign.projectId,
            timelineId: timeline.id,
            timelineRevision: timeline.revision,
            presetId,
            codec: 'h264',
            rate: { num: 60, den: 1 },
            captions: { burnIn: true, sidecars: ['srt', 'vtt'] },
            includeBumpers: false,
          },
          { source: 'agent', actor: `product:${campaign.productId}` },
        );
        if (!rendered.ok) return rendered;
        const receipt = exported.safeParse(rendered.value.result);
        if (!receipt.success) return err(ValidationError({ field: 'product.render' }));
        renders.push({
          renderId: receipt.data.renderId,
          timelineId: timeline.id,
          timelineRevision: timeline.revision,
          presetId,
        });
      }
    }
    const latest = await products.getCampaign(campaign.id);
    if (!latest.ok) return latest;
    const saved = await products.saveCampaign(
      { ...latest.value, renders, revision: latest.value.revision + 1, updatedAt: Date.now() },
      latest.value.revision,
    );
    return saved.ok ? ok(false) : saved;
  }
  if (
    required.length !== timelines.length * 2 ||
    required.some(
      (render) =>
        !timelines.some(
          (timeline) => timeline.id === render.timelineId && timeline.revision === render.timelineRevision,
        ),
    )
  )
    return err(ValidationError({ field: 'product.renderRevision' }));
  let complete = true;
  for (const reference of required) {
    const found = await container.resolve(RenderStoreToken).get(reference.renderId);
    if (!found.ok) return found;
    const render = found.value;
    if (
      render.projectId !== campaign.projectId ||
      render.timelineId !== reference.timelineId ||
      render.timelineRevision !== reference.timelineRevision ||
      render.presetId !== reference.presetId
    )
      return err(ValidationError({ field: 'product.renderIdentity' }));
    if (['failed', 'cancelled', 'needsAttention'].includes(render.status))
      return err(
        ValidationError({ field: 'product.renderFailed' }, { detail: render.error?.code ?? render.status }),
      );
    if (render.status !== 'ready') complete = false;
    else if (!render.filePath || !render.qa || !['passed', 'passedWithWarnings'].includes(render.qa.verdict))
      return err(ValidationError({ field: 'product.renderQa' }));
  }
  return ok(complete);
}
