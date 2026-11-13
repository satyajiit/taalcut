// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: publish-pack-card · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.7 · decision card (CardFrame): Hallmark multi-aspect video thumbnail studio (16:9 YouTube,
 *   9:16 Shorts/Reels/TikTok, 4:5 IG feed, 1:1 IG grid) with live archetype/theme switching, safe zones, channel
 *   branding and squint feed preview, paired with researched multi-select copy-and-paste social metadata.
 * states: canvas / feed preview · safe-zone guide · channel badge on/off · alternate YouTube title selection ·
 *   multi-select social blocks · clipboard copied confirmation · follow-up for additional takes
 * pre-emit critique: P5 H5 E5 S5 R5 V5 */

import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { CardOf } from '@taalcut/core';
import { useState } from 'react';
import { AiMark } from '#components/ai-mark';
import { Chip } from '#components/badge';
import { useFormatters } from '#lib/format';
import { useFollowUp } from '../media/use-command';
import { CardFrame } from './card-frame';
import { PublishSocialMeta } from './publish-social-meta';
import { PublishThumbnailStudio } from './publish-thumbnail-studio';
import { ShortCover } from './short-cover';

type Card = CardOf<'publishPack'>;

/** Multi-aspect Hallmark thumbnail studio and copy-and-paste social publishing pack. */
export function PublishPackCard({ card }: { card: Card }) {
  const { t } = useLingui();
  const format = useFormatters();
  const followUp = useFollowUp(card.runId);
  const [selectedYtTitle, setSelectedYtTitle] = useState<string>(card.social.youtube.title);

  const aspectCount = card.thumbnails.length;
  const takeCount = card.thumbnails.reduce((sum, variant) => sum + variant.takes.length, 0);
  const spent = format.money(card.spent);

  return (
    <CardFrame
      cardType="publishPack"
      title={aspectCount > 0 ? t`Thumbnail & publish pack` : t`Publishing copy`}
      aside={
        <Chip tone="ai">
          <AiMark aria-hidden />
          {t`Ready to review`}
        </Chip>
      }
    >
      {aspectCount > 0 ? (
        <p className="m-0 type-meta text-ink-2 tabular-nums">
          {t`${plural(aspectCount, { one: '# format', other: '# formats' })} · ${plural(takeCount, { one: '# take', other: '# takes' })} · ${spent} so far`}
        </p>
      ) : null}
      {card.coverAssetId ? <ShortCover card={card} assetId={card.coverAssetId} /> : null}

      {aspectCount > 0 ? (
        <PublishThumbnailStudio card={card} selectedYtTitle={selectedYtTitle} followUp={followUp} />
      ) : null}

      <PublishSocialMeta
        social={card.social}
        selectedYtTitle={selectedYtTitle}
        onSelectYtTitle={setSelectedYtTitle}
        notesTitle={aspectCount === 0 ? t`Source and publishing notes` : undefined}
      />
    </CardFrame>
  );
}
