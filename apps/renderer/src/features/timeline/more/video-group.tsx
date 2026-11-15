// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the More tab's video group (MORE1) · system: DESIGN.md v0.7
 * what can be done to the whole video (lime): Cover, whose chip shows the cover saved for the video's shape (the
 *   frame or picture it was made from, drawn to that shape) and which opens the cover panel; Make another size,
 *   which says the size the video has and opens its dialog. Under the group's title, the video in one line: how
 *   long, how many clips, and its beat where there is room. The tiles are one column of equal rows, so another
 *   (`children`, placed after Cover) joins them and nothing else moves
 * states: a cover saved (its picture) · none yet (the cover's glyph) · the picture still loading (the viewer
 *   grey) · the AI editing (Make another size waits and says why; Cover still opens: its panel has its own
 *   pause)
 * motion: none of its own (a tile's value fades when it changes)
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { Timeline } from '@taalcut/core';
import { cn, CONCEPT_ICONS, useTimecode } from '@taalcut/ui';
import { useEffect, useId, useState, type ReactNode, type Ref } from 'react';
import { mediaOf, type TimelineModel } from '../model';
import type { ShotLookup } from '../shot-frames';
import type { Edits } from '../use-edits';
import { MoreTile } from './more-tile';
import { aspectOf, coverWords } from './more-words';

export type VideoSurface = 'cover' | 'size';

/** The picture the cover for this video's shape was made from: a saved picture, or the frame's scene. */
function useCoverStill(timeline: Timeline, model: TimelineModel, lookup: ShotLookup): string | null {
  const aspect = aspectOf(timeline.canvas);
  const covers = timeline.covers ?? [];
  const cover = covers.find((saved) => saved.aspect === aspect) ?? covers.at(-1);
  const [, setLoaded] = useState(0);
  const assetId = cover?.source.kind === 'asset' ? cover.source.assetId : null;
  // A generated cover's picture is a file the timeline's clips don't name: load it.
  useEffect(() => {
    if (!assetId || lookup.loaded(assetId) !== undefined) return;
    let live = true;
    void lookup.detail(assetId).then(() => {
      if (live) setLoaded((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [assetId, lookup]);
  if (!cover) return null;
  if (cover.source.kind === 'asset') return lookup.frameNow(cover.source.assetId, null)?.url ?? null;
  if (cover.source.kind !== 'frame') return null;
  const frame = cover.source.frame;
  const scene = model.clips.find((view) => frame >= view.start && frame < view.end) ?? model.clips[0];
  if (!scene) return null;
  const media = mediaOf(scene.item);
  return lookup.frameNow(media.assetId, media.shotId)?.url ?? null;
}

export interface VideoGroupProps {
  timeline: Timeline;
  model: TimelineModel;
  edits: Edits;
  lookup: ShotLookup;
  open: VideoSurface | null;
  tileRef(surface: VideoSurface): Ref<HTMLButtonElement>;
  onOpen(surface: VideoSurface): void;
  /** Comment on the video, beside its title (when no scene is selected). */
  comments?: ReactNode;
  /** More tiles for the whole video, placed after Cover (a `MoreTile` with `family="video"` each). */
  children?: ReactNode;
  /** Alone in a wide panel: its tiles sit side by side. */
  wide?: boolean;
  className?: string;
}

export function VideoGroup({
  timeline,
  model,
  edits,
  lookup,
  open,
  tileRef,
  onOpen,
  comments,
  children,
  wide = false,
  className,
}: VideoGroupProps) {
  const { t, i18n } = useLingui();
  const time = useTimecode();
  const titleId = useId();
  const saved = timeline.covers?.length ?? 0;
  const still = useCoverStill(timeline, model, lookup);
  const { width, height } = timeline.canvas;
  const aspect = aspectOf(timeline.canvas);
  const size = aspect ?? `${i18n.number(width)} × ${i18n.number(height)}`;
  const bpm = model.bpm ? i18n.number(Math.round(model.bpm)) : null;
  const clips = model.clips.length;
  return (
    <section data-slot="more-video" aria-labelledby={titleId} className={cn('min-w-0', className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-h-8 items-center justify-between gap-2">
          <h2 id={titleId} className="m-0 type-card-title text-ink">
            <Trans>This video</Trans>
          </h2>
          {comments}
        </div>
        <p className="m-0 type-meta text-ink-2 tabular-nums">
          {time.length(model.total, model.rate)} · <Plural value={clips} one="# clip" other="# clips" />
          {bpm ? (
            // Beside the scene's tiles the column is too narrow for it; stacked or alone, it is said.
            <span className={wide ? undefined : '@lg:hidden'}>
              {' '}
              · <Trans>{bpm} beats a minute</Trans>
            </span>
          ) : null}
        </p>
      </div>
      <div
        data-slot="more-video-tiles"
        className={cn('grid grid-cols-1 content-start gap-1 min-[1280px]:gap-2', wide && '@lg:grid-cols-2')}
      >
        <MoreTile
          id="cover"
          ref={tileRef('cover')}
          open={open === 'cover'}
          family="video"
          icon={CONCEPT_ICONS.cover}
          // The saved cover's picture, drawn to the video's shape inside the chip.
          picture={
            saved > 0 ? (
              <span
                data-slot="more-cover"
                className={cn('block overflow-hidden rounded-xs bg-viewer', width > height ? 'w-7' : 'h-7')}
                style={{ aspectRatio: `${width} / ${height}` }}
              >
                {still ? (
                  <img src={still} alt="" draggable={false} className="size-full object-cover" />
                ) : null}
              </span>
            ) : undefined
          }
          name={t`Cover`}
          value={coverWords(i18n, saved)}
          onOpen={() => onOpen('cover')}
        />
        {children}
        <MoreTile
          id="size"
          ref={tileRef('size')}
          dialog
          open={open === 'size'}
          family="video"
          icon={CONCEPT_ICONS.videoSize}
          name={t`Make another size`}
          value={t`This video is ${size}`}
          reason={edits.aiPaused ? t`Waits while Taalcut edits` : null}
          onOpen={() => onOpen('size')}
        />
      </div>
    </section>
  );
}
