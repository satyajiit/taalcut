// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { Button } from '#components/button';
import { useLiveTimeline } from './card-data';
import { CoverEditor, coverFromVariant } from './cover-editor';
import { FollowUpLine } from '../media/media-lines';
import { PreviewThumbnailStudio, type PublishThumbnailStudioProps } from './publish-thumbnail-preview';

export function PublishThumbnailStudio(props: PublishThumbnailStudioProps) {
  const timeline = useLiveTimeline(props.card.timelineId ?? null);
  const { t } = useLingui();
  if (!timeline) return <PreviewThumbnailStudio {...props} />;
  const channel = props.card.channel;
  const initial = {
    ...coverFromVariant(props.card.thumbnails[0]!),
    ...(channel && props.card.thumbnails[0]?.composition !== 'complete'
      ? { channel: { name: channel.name ?? '', handle: channel.handle ?? '', show: channel.showOnThumbnail } }
      : {}),
  };
  return (
    <div className="flex flex-col gap-3">
      <CoverEditor timeline={timeline} initial={initial} variants={props.card.thumbnails} />
      {props.followUp.can ? (
        <Button
          size="sm"
          variant="secondary"
          loading={props.followUp.busy === 'more-thumb'}
          onClick={() =>
            void props.followUp.send('more-thumb', t`Make another thumbnail take for this video.`)
          }
        >{t`Make another take`}</Button>
      ) : null}
      <FollowUpLine followUp={props.followUp} />
    </div>
  );
}
