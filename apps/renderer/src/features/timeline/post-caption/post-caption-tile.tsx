// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The More gallery's Post caption tile (CAP1 on MORE1's gallery): beside Cover in the video's group, it says in
 * words whether this video has a caption and who wrote it, and opens the caption dialog. The dialog is mounted
 * only while it is open, so focus goes back to the tile when it closes.
 */
import { useLingui } from '@lingui/react/macro';
import type { Timeline } from '@taalcut/core';
import { CONCEPT_ICONS } from '@taalcut/ui';
import { useState } from 'react';
import { MoreTile } from '../more/more-tile';
import { PostCaptionDialog } from './post-caption-dialog';
import { postCaptionTileWords } from './post-caption-words';

export function PostCaptionTile({ timeline }: { timeline: Timeline }) {
  const { t, i18n } = useLingui();
  const [open, setOpen] = useState(false);
  return (
    <>
      <MoreTile
        id="caption"
        family="video"
        dialog
        open={open}
        icon={CONCEPT_ICONS.text}
        name={t`Post caption`}
        value={postCaptionTileWords(i18n, timeline)}
        onOpen={() => setOpen(true)}
      />
      {open ? <PostCaptionDialog timeline={timeline} open onOpenChange={setOpen} /> : null}
    </>
  );
}
