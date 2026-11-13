// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  err,
  idSchema,
  ok,
  RationalTime,
  StyleStoreToken,
  ValidationError,
  type AsyncResult,
  type Container,
  type PublishPackCard,
  type ShortsRun,
  type Style,
} from '@taalcut/core';
import { buildShortSocialMetadataPack } from '@taalcut/models';
import { createShortsCache } from '@taalcut/library';
import { z } from 'zod';
import { renderTimelines } from '../../shared/render-ports';
import { LibraryDatabaseToken } from '../../shared/tokens';

/** Copy stays tied to the persisted accepted candidate; generating images is never a prerequisite. */
export async function createShortPublishPack(
  container: Container,
  run: ShortsRun,
): AsyncResult<PublishPackCard> {
  const plan = run.plan;
  const candidate = run.candidates.find((candidate) => candidate.id === plan?.candidateId);
  if (!plan || !candidate || !run.timelineId)
    return err(
      ValidationError(
        { field: 'shorts.publishPack' },
        { detail: 'No accepted source selection and timeline' },
      ),
    );
  const timeline = await renderTimelines(container).get(run.timelineId);
  if (!timeline.ok) return timeline;
  const cachedCover = await createShortsCache(container.resolve(LibraryDatabaseToken)).get(
    `shorts.cover:${run.id}`,
  );
  if (!cachedCover.ok) return cachedCover;
  const cover = z.object({ assetId: idSchema<'Asset'>() }).safeParse(cachedCover.value);
  let style: Style | null = null;
  if (timeline.value.styleId && container.has(StyleStoreToken)) {
    const found = await container.resolve(StyleStoreToken).get(timeline.value.styleId);
    if (!found.ok) return found;
    style = found.value;
  }
  const spans = candidate.speech.length ? candidate.speech : candidate.visuals;
  const from = Math.min(...spans.map((span) => RationalTime.toSeconds(span.range.start)));
  const to = Math.max(
    ...spans.map((span) => RationalTime.toSeconds(RationalTime.add(span.range.start, span.range.duration))),
  );
  const social = buildShortSocialMetadataPack({
    title: candidate.title,
    hook: candidate.hook,
    summary: [candidate.context, candidate.payoff].filter(Boolean).join(' '),
    ...(run.request.sourceUrl ? { sourceUrl: run.request.sourceUrl } : {}),
    ...(spans.length === 1 ? { sourceStartSeconds: from, sourceEndSeconds: to } : {}),
    ...(style?.creator ? { creator: style.creator } : {}),
  });
  return ok({
    type: 'publishPack',
    id: `shorts-publish:${run.id}`,
    version: 1,
    projectId: run.request.projectId,
    timelineId: run.timelineId,
    thumbnails: [],
    ...(cover.success ? { coverAssetId: cover.data.assetId } : {}),
    social,
    spent: { currency: 'USD', micros: 0 },
    ...(style?.creator
      ? {
          channel: {
            ...(style.creator.name ? { name: style.creator.name.slice(0, 60) } : {}),
            ...(style.creator.youtubeHandle ? { handle: style.creator.youtubeHandle.slice(0, 40) } : {}),
            showOnThumbnail: false,
          },
        }
      : {}),
  });
}
