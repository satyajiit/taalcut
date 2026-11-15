// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the More tab's gallery (MORE1) · system: DESIGN.md v0.7 (Footage First; a
 *   family's colour beside its glyph and its words, never alone)
 * the More tab, in the simple view's lower panel and the detailed timeline's side panel alike: two short groups
 *   of tiles, "This scene" (scene-group.tsx) and "This video" (video-group.tsx). A tile opens the surface that
 *   suits its job. What is judged by eye (Speed, Transition, Colour) opens a sheet in the tiles' own place, so the
 *   viewer above is never covered. What ends in a discrete result opens a dialog: Freeze (a held moment), Why
 *   this shot (reading), Make another size (a new video). Cover opens the cover panel
 * layout: side by side from 32rem of panel (the scene's tiles two across, the video's in a column beside them);
 *   one column in the detailed timeline's narrow side panel. It fits the lower panel without scrolling at
 *   1280 × 800
 * states: a scene selected · none (the scene group explains itself; the video group works) · a sheet open (the
 *   tiles hide behind it and return with focus on the tile that opened it) · a dialog open · the selection
 *   changing under an open sheet (it follows the new scene, or closes when that scene has no such choice)
 * motion: a sheet's arrival and a tile's value fading when it changes; reduced motion: fades alone
 */
import { useLingui } from '@lingui/react/macro';
import type { Timeline, TimelineId, TimelineItemId } from '@taalcut/core';
import { cn } from '@taalcut/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { hasNext } from '../edit-ops';
import { mediaOf, type ClipView, type TimelineModel } from '../model';
import type { Playhead } from '../playhead';
import type { EditorSelection } from '../selection';
import type { ShotLookup } from '../shot-frames';
import type { Edits } from '../use-edits';
import { ColourSheet } from './colour-sheet';
import { FreezeDialog } from './freeze-dialog';
import { aspectOf } from './more-words';
import { SceneGroup, type SceneSurface } from './scene-group';
import { SizeDialog } from './size-dialog';
import { SpeedSheet, TransitionSheet } from './speed-sheet';
import { VideoGroup, type VideoSurface } from './video-group';
import { WhyDialog } from './why-dialog';

type Surface = SceneSurface | VideoSurface;
/** The surfaces that take the tiles' place instead of covering the editor. */
const SHEETS: readonly Surface[] = ['speed', 'transition', 'colour'];

/** A group lays its title lines and its tiles on the gallery's two rows. */
const GROUP = 'row-span-2 grid grid-rows-subgrid gap-y-2';

/** Whether a scene still has the choice an open sheet offers (a photo has no speed, the last scene no next). */
function offers(surface: Surface, clip: ClipView, model: TimelineModel): boolean {
  if (surface === 'speed') return clip.item.media.kind === 'video' && !clip.item.holdFrame;
  if (surface === 'transition') return hasNext(model, clip);
  return true;
}

export interface MoreGalleryProps {
  timeline: Timeline;
  model: TimelineModel;
  selection: EditorSelection;
  playhead: Playhead;
  edits: Edits;
  lookup: ShotLookup;
  onSelect(selection: EditorSelection): void;
  onAddToChat(): void;
  onCover(): void;
  onVideo(id: TimelineId): void;
  /** The simple view's way back to its scenes, to pick one; absent where the timeline is on screen. */
  onScenes?: (() => void) | undefined;
  /** A designed video with nothing selected: the video's own tiles alone, above its design's inspector. */
  videoOnly?: boolean;
  /** Comment… on what is selected (the scene, else the video), shown beside that group's title. */
  comments?: ReactNode;
  /**
   * More tiles for the whole video, placed after Cover (video-group.tsx). Each is a `MoreTile` with
   * `family="video"` (more-tile.tsx), or a component that renders one and owns its dialog.
   */
  videoTiles?: ReactNode;
}

export function MoreGallery({
  timeline,
  model,
  selection,
  playhead,
  edits,
  lookup,
  onSelect,
  onAddToChat,
  onCover,
  onVideo,
  onScenes,
  videoOnly = false,
  comments,
  videoTiles,
}: MoreGalleryProps) {
  const { t } = useLingui();
  const clip =
    selection?.kind === 'clip' ? model.clips.find((view) => view.item.id === selection.clipId) : undefined;
  const [open, setOpen] = useState<Surface | null>(null);
  // The playhead's frame when Freeze opened: the dialog shows that frame and sends that moment.
  const [moment, setMoment] = useState(0);
  // A moment just frozen is a new scene: once the timeline has it, it becomes the selection.
  const [frozen, setFrozen] = useState<TimelineItemId | null>(null);
  const tiles = useRef(new Map<Surface, HTMLButtonElement | null>());
  const opener = useRef<Surface | null>(null);
  const tileRef = (surface: Surface) => (node: HTMLButtonElement | null) => {
    tiles.current.set(surface, node);
  };

  const show = (surface: Surface) => {
    if (surface === 'cover') return onCover();
    if (surface === 'freeze') {
      // "This moment" is the frame on show: hold it there while the dialog asks how long.
      playhead.pause();
      setMoment(playhead.frame());
    }
    opener.current = surface;
    setOpen(surface);
  };
  const close = () => setOpen(null);

  // A sheet hid the tiles: when it closes, focus goes back to the tile that opened it. (A dialog gives focus
  // back itself.)
  useEffect(() => {
    if (open !== null) return;
    if (opener.current && SHEETS.includes(opener.current)) tiles.current.get(opener.current)?.focus();
    opener.current = null;
  }, [open]);
  // A scene's surface needs a scene that has that choice.
  const lost = open !== null && open !== 'size' && (!clip || !offers(open, clip, model));
  useEffect(() => {
    if (lost) setOpen(null);
  }, [lost]);
  useEffect(() => {
    if (!frozen || !model.clips.some((view) => view.item.id === frozen)) return;
    setFrozen(null);
    onSelect({ kind: 'clip', clipId: frozen });
  }, [frozen, model]);

  const sheet = clip && open && SHEETS.includes(open) && !lost ? open : null;
  const off = !clip
    ? null
    : clip.item.locked
      ? t`Unlock this scene first`
      : edits.aiPaused
        ? t`This waits while Taalcut edits this video.`
        : null;
  const media = clip ? mediaOf(clip.item) : model.clips[0] ? mediaOf(model.clips[0].item) : null;
  const still = media ? (lookup.frameNow(media.assetId, media.shotId)?.url ?? null) : null;
  const { width, height } = timeline.canvas;
  const Root = videoOnly ? 'section' : 'aside';

  return (
    <Root
      aria-label={videoOnly ? t`Video actions` : t`Inspector`}
      data-slot={videoOnly ? 'more-video-only' : 'inspector'}
      className={cn(
        '@container flex min-w-0 flex-col p-2 min-[1280px]:p-3',
        videoOnly && 'border-b border-rule-subtle',
      )}
    >
      {sheet === 'speed' && clip ? (
        <SpeedSheet clip={clip} model={model} edits={edits} off={off} onClose={close} />
      ) : sheet === 'transition' && clip ? (
        <TransitionSheet clip={clip} model={model} edits={edits} off={off} onClose={close} />
      ) : sheet === 'colour' && clip ? (
        <ColourSheet
          clip={clip}
          model={model}
          edits={edits}
          off={off}
          still={still}
          videoGrade={timeline.grade}
          onClose={close}
        />
      ) : null}
      {/* Two rows shared by both groups (their title lines, their tiles), so the tiles of one line up with the
          tiles of the other whatever the title lines say. */}
      <div
        hidden={sheet !== null}
        data-slot="more-gallery"
        className={cn('grid gap-x-4 gap-y-2', !videoOnly && '@lg:grid-cols-[minmax(0,1fr)_13rem]')}
      >
        {videoOnly ? null : (
          <SceneGroup
            clip={clip}
            model={model}
            videoGrade={timeline.grade}
            edits={edits}
            lookup={lookup}
            open={open === 'cover' || open === 'size' ? null : open}
            tileRef={tileRef}
            onOpen={show}
            onAddToChat={onAddToChat}
            onScenes={onScenes}
            comments={comments}
            className={GROUP}
          />
        )}
        <VideoGroup
          timeline={timeline}
          model={model}
          edits={edits}
          lookup={lookup}
          open={open === 'cover' || open === 'size' ? open : null}
          tileRef={tileRef}
          onOpen={show}
          wide={videoOnly}
          comments={clip || videoOnly ? null : comments}
          className={cn(
            GROUP,
            // Stacked, a hairline above it; beside the scene's tiles, a hairline between them.
            !videoOnly &&
              'mt-1 border-t border-rule-subtle pt-3 @lg:mt-0 @lg:border-s @lg:border-t-0 @lg:ps-4 @lg:pt-0',
          )}
        >
          {videoTiles}
        </VideoGroup>
      </div>
      {open === 'freeze' && clip && !lost ? (
        <FreezeDialog
          clip={clip}
          model={model}
          lookup={lookup}
          shape={width / height}
          at={moment}
          edits={edits}
          onOpenChange={(next) => !next && close()}
          onDone={setFrozen}
        />
      ) : open === 'why' && clip ? (
        <WhyDialog clip={clip} lookup={lookup} onOpenChange={(next) => !next && close()} />
      ) : null}
      {open === 'size' ? (
        <SizeDialog
          current={aspectOf(timeline.canvas)}
          still={still}
          edits={edits}
          onOpenChange={(next) => !next && close()}
          onVideo={onVideo}
        />
      ) : null}
    </Root>
  );
}
