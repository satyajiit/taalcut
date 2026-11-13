// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import { openAsBlob } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  CreationStoreToken,
  err,
  ok,
  RenderStoreToken,
  TimelineStoreToken,
  ValidationError,
  type AsyncResult,
  type Container,
  type ProductPlatform,
  type ProductStore,
  type RenderId,
  type RenderRecord,
} from '@taalcut/core';
import type { ProductPublishDraft } from '@taalcut/tools';
import { hasPreset, presetFor } from '@taalcut/render';

const invalid = (detail: string) => err(ValidationError({ field: 'publication.media' }, { detail }));

/** Conservative delivery profiles; the 4K master remains available even where a derivative is needed. */
export function productDeliveryReady(render: RenderRecord, platform: ProductPlatform): boolean {
  const fps = render.rate.num / render.rate.den;
  const seconds = render.durationFrames / fps;
  // Shorts classification requires square or vertical; a landscape upload would be a regular video.
  if (platform === 'youtube' && render.width > render.height) return false;
  if (platform === 'instagram') {
    if (!hasPreset(render.presetId)) return false;
    const preset = presetFor(render.presetId);
    // Use our established Instagram AAC target; a generic192kbps delivery is not its API profile.
    if (
      preset.audio.bitrateKbps !== 128 ||
      seconds < 3 ||
      seconds > Math.min(179, preset.duration.maxSeconds)
    )
      return false;
  }
  const maxBytes =
    platform === 'x'
      ? 512 * 1024 ** 2
      : platform === 'youtube' || platform === 'linkedin'
        ? 2 * 1024 ** 3
        : 1024 ** 3;
  return (
    render.status === 'ready' &&
    render.deletedAt === null &&
    render.filePath !== null &&
    extname(render.filePath).toLowerCase() === '.mp4' &&
    render.qa !== null &&
    ['passed', 'passedWithWarnings'].includes(render.qa.verdict) &&
    render.bytes !== null &&
    render.bytes > 0 &&
    render.bytes <= maxBytes &&
    fps >= 24 &&
    fps <= 60 &&
    seconds > 0 &&
    seconds <= (platform === 'x' ? 140 : 180) &&
    render.width <= (platform === 'youtube' ? 3840 : 1920) &&
    render.height <= (platform === 'youtube' ? 3840 : 1920) &&
    (platform === 'youtube' || (render.request.codec ?? 'h264') === 'h264')
  );
}

export async function productRenderHash(render: RenderRecord): AsyncResult<string> {
  if (!render.filePath) return invalid('The render has no file');
  try {
    const stat = await lstat(render.filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > 2 * 1024 ** 3 || stat.size !== render.bytes)
      return invalid('The exported file changed');
    const blob = await openAsBlob(render.filePath);
    const hash = createHash('sha256');
    for await (const chunk of blob.stream()) hash.update(chunk);
    return ok(hash.digest('hex'));
  } catch {
    return invalid('The exported file is unavailable or changed');
  }
}

export function productPublishMedia(container: Container, products: ProductStore) {
  const renders = container.resolve(RenderStoreToken);
  const timelines = container.resolve(TimelineStoreToken);
  async function current(render: RenderRecord, draft: Pick<ProductPublishDraft, 'productId' | 'campaignId'>) {
    const campaign = await products.getCampaign(draft.campaignId);
    if (!campaign.ok) return campaign;
    if (campaign.value.productId !== draft.productId || campaign.value.projectId !== render.projectId)
      return invalid('The render does not belong to this product campaign');
    const timeline = await timelines.get(render.timelineId);
    if (!timeline.ok) return timeline;
    if (
      timeline.value.summary.projectId !== render.projectId ||
      timeline.value.summary.revision !== render.timelineRevision
    )
      return invalid('Export the current timeline before approving publication');
    if (container.has(CreationStoreToken)) {
      const creation = await container.resolve(CreationStoreToken).get(render.projectId);
      if (!creation.ok) return creation;
      if (creation.value.status !== 'ready')
        return invalid('Finish the current video changes before publication');
    }
    return ok(undefined);
  }
  return {
    renders,
    current,
    async verifyRender(id: RenderId, expected: string, draft: ProductPublishDraft): AsyncResult<boolean> {
      const found = await renders.get(id);
      if (!found.ok) return found;
      if (!productDeliveryReady(found.value, draft.platform)) return ok(false);
      const valid = await current(found.value, draft);
      if (!valid.ok) return valid;
      const hash = await productRenderHash(found.value);
      return hash.ok ? ok(hash.value === expected) : hash;
    },
  };
}
