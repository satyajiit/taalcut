// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: video switcher · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * in the window bar: which of the project's videos (its variant cuts) is open, "Video 2 of 3", and a menu of
 *   them with their lengths, then Compare side by side when the open video has variants (P3-V3: the compare view,
 *   `?compare=<castId>`); saved snapshots are versions (the Versions dock), never this
 * states: the kit's Button and DropdownMenu (default, hover, focus, active, open) · disabled: one video only ·
 *   loading/error/success: n/a (the list is the page's) · pre-emit critique: P4 H5 E4 S5 R5 V4 */
import { Plural, useLingui } from '@lingui/react/macro';
import type { TimelineId, TimelineSummary } from '@taalcut/core';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  UserContent,
  useTimecode,
} from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { ChevronDown, Clapperboard, Columns3 } from 'lucide-react';
import { navigateCardLink } from '../../chat/card-links';

export interface VideoSwitcherProps {
  videos: readonly TimelineSummary[];
  activeId: TimelineId;
  onPick: (id: TimelineId) => void;
}

export function VideoSwitcher({ videos, activeId, onPick }: VideoSwitcherProps) {
  const { t, i18n } = useLingui();
  const time = useTimecode();
  const navigate = useNavigate();
  const at = videos.findIndex((video) => video.id === activeId);
  if (at < 0 || videos.length < 2) return null;
  const open = videos[at];
  const castId = open?.castId ?? null;
  const variants = castId ? videos.filter((video) => video.castId === castId).length : 0;
  const n = i18n.number(at + 1);
  const of = i18n.number(videos.length);
  const customTitle = (raw: string | undefined) => {
    const trimmed = raw?.trim() ?? '';
    return trimmed && !/^video\s+\d+$/i.test(trimmed) ? trimmed : null;
  };
  const openTitle = customTitle(open?.name);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" data-slot="video-switcher">
          <Clapperboard aria-hidden />
          {/* Under 1280 px the window bar is crowded (main's GitHub links share it): "2/3", the words to screen readers. */}
          <span className="sr-only xl:not-sr-only">{t`Video ${n} of ${of}`}</span>
          {openTitle ? (
            <span
              aria-hidden
              translate="no"
              title={`· ${openTitle}`}
              className="hidden max-w-28 truncate text-ink-2 xl:inline-block"
            >
              · <UserContent translate="no">{openTitle}</UserContent>
            </span>
          ) : null}
          <span aria-hidden className="tabular-nums xl:hidden">
            {n}/{of}
          </span>
          <ChevronDown aria-hidden className="text-ink-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>{t`This project’s videos`}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={activeId} onValueChange={(value) => onPick(value as TimelineId)}>
          {videos.map((video, index) => {
            const number = i18n.number(index + 1);
            const title = customTitle(video.name);
            return (
              <DropdownMenuRadioItem key={video.id} value={video.id} data-video={video.id}>
                <span className="flex flex-1 items-baseline justify-between gap-4">
                  <span className="min-w-0 truncate text-sm text-ink">
                    {t`Video ${number}`}
                    {title ? (
                      <span className="text-ink-2">
                        {' · '}
                        <UserContent translate="no">{title}</UserContent>
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs text-ink-2 tabular-nums">
                    {time.length(video.duration.value, video.duration.rate)} ·{' '}
                    <Plural value={video.clipCount} one="# clip" other="# clips" />
                  </span>
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        {open && castId && variants > 1 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-slot="compare-variants"
              onSelect={() =>
                navigateCardLink(navigate, {
                  to: 'timeline',
                  projectId: open.projectId,
                  timelineId: open.id,
                  compare: castId,
                })
              }
            >
              <Columns3 aria-hidden />
              {t`Compare side by side`}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
