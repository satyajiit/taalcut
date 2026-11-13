// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import type { AssetId, CardOf } from '@taalcut/core';
import { useEffect, useState } from 'react';
import { Button } from '#components/button';
import { useShotFrames } from '../make/use-shot-frames';
import { useCardActions } from './card-actions';
import { useCardData } from './card-data';

/** An exported cover is already designed: display its pixels without layering another design on them. */
export function ShortCover({ card, assetId }: { card: CardOf<'publishPack'>; assetId: AssetId }) {
  const { t } = useLingui();
  const actions = useCardActions();
  const { watchAssetImage } = useCardData();
  const [live, setLive] = useState<{ assetId: AssetId; url: string | null } | null>(null);
  useEffect(() => watchAssetImage?.(assetId, (url) => setLive({ assetId, url })), [assetId, watchAssetImage]);
  const shot = { assetId, shotId: null };
  const frame = useShotFrames([shot])(shot);
  const url = live?.assetId === assetId ? live.url : frame?.url;
  return (
    <section className="flex flex-col items-start gap-3" aria-label={t`Cover from your short`}>
      {url ? (
        <img
          src={url}
          alt={t`Cover exported from this short`}
          className="max-h-80 w-auto rounded-lg border border-rule object-contain"
        />
      ) : (
        <p className="m-0 type-body text-ink-2">{t`Your cover is saved with the video.`}</p>
      )}
      {actions.navigate && card.timelineId ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            actions.navigate?.({ to: 'timeline', projectId: card.projectId, timelineId: card.timelineId })
          }
        >
          {t`Open editor`}
        </Button>
      ) : null}
    </section>
  );
}
