// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: a saved reel (Saved on Instagram; UX3, UX4 tpl) · system: DESIGN.md v0.6 + UX4
 *   (ListRow)
 * one saved Instagram Reel as the kit's list row: its 9:16 frame leads (a film glyph on the sunken grey while it
 *   has none), its caption as written, then @creator, its length and the day it was saved; at the end, a reel
 *   already read is Ready (the success chip) with Open template, and any other has Read this reel (a chat reads
 *   it into a template)
 * states: the row's (default · hover · focus-visible on its buttons · active) · Ready (chip) · the buttons' eight
 */
import { Trans } from '@lingui/react/macro';
import type { InstagramSavedReel } from '@taalcut/core';
import { Button, Chip, ListRow, useFormatters } from '@taalcut/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { CircleCheck, Film } from 'lucide-react';
import { useState } from 'react';
import { openChatWithDraft } from '../chat-draft';
import { TEMPLATE_ICONS } from '../template-icons';

export interface SavedReelRowProps {
  readonly reel: InstagramSavedReel;
}

function isCspAllowedThumbnail(url: string | null): url is string {
  if (!url) return false;
  return url.startsWith('app://') || url.startsWith('data:') || url.startsWith('blob:');
}

function Frame({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="flex aspect-[9/16] w-11 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-rule bg-sunken">
      {isCspAllowedThumbnail(url) && !failed ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <Film aria-hidden className="size-4 text-ink-3" />
      )}
    </span>
  );
}

export function SavedReelRow({ reel }: SavedReelRowProps) {
  const formatters = useFormatters();
  const navigate = useNavigate();
  const title = reel.caption?.trim() || reel.shortcode;
  return (
    <ListRow
      data-slot="saved-reel-row"
      data-shortcode={reel.shortcode}
      leading={<Frame url={reel.thumbnailUrl} />}
      title={
        <span className="line-clamp-1" dir="auto" translate="no">
          {title}
        </span>
      }
      meta={
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {reel.authorHandle ? (
            <span dir="auto" translate="no">
              @{reel.authorHandle}
            </span>
          ) : null}
          {reel.durationMs !== null ? (
            <span className="text-ink-3 tabular-nums">{formatters.duration(reel.durationMs)}</span>
          ) : null}
          <time dateTime={new Date(reel.savedAt).toISOString()} className="text-ink-3">
            {formatters.relativeDay(reel.savedAt)}
          </time>
        </span>
      }
      actions={
        reel.templateId ? (
          <span className="flex items-center gap-2">
            <Chip tone="success">
              <CircleCheck aria-hidden />
              <Trans>Ready</Trans>
            </Chip>
            <Button asChild size="sm" variant="secondary" icon={TEMPLATE_ICONS.open}>
              <Link to="/templates/$templateId" params={{ templateId: reel.templateId }}>
                <Trans>Open template</Trans>
              </Link>
            </Button>
          </span>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            icon={TEMPLATE_ICONS.readReel}
            onClick={() => openChatWithDraft(navigate, reel.permalink)}
          >
            <Trans>Read this reel</Trans>
          </Button>
        )
      }
    />
  );
}
