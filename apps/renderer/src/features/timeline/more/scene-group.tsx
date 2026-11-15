// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the More tab's scene group (MORE1) · system: DESIGN.md v0.7
 * what can be done to the selected scene: its title (number, shot type) with Lock, Add to chat and Comment
 *   beside it, one line under it (when and how long; or why its tiles wait), then its tiles: Speed and Freeze
 *   (time, sky), Transition (the join, orchid), Colour (the picture, coral) and Why this shot (the AI's violet or
 *   your teal). Each names its value in words and opens its own surface. A sixth tile fits the grid as it is
 * states: a scene (the tiles act) · no scene (the line says how to pick one, with the way back to the scenes in
 *   the simple view; the tiles are flat and say what each would do) · locked (the line says so; the tiles keep
 *   their values and wait; Why still opens) · the AI editing (the same, in the AI's colour) · a photo (no speed,
 *   no moment to freeze: each tile says why) · a held moment (no speed; Freeze is Held moment, with its length)
 *   · the last scene (no transition: said). The line is always there, so locking a scene moves nothing
 * motion: none of its own (a tile's value fades when it changes)
 */
import { useLingui } from '@lingui/react/macro';
import {
  AiMarkIcon,
  Button,
  cn,
  CONCEPT_ICONS,
  Confidence,
  SHOT_TYPE_LABELS,
  useTimecode,
  VERB_ICONS,
} from '@taalcut/ui';
import { Lock } from 'lucide-react';
import { useId, type ReactNode, type Ref } from 'react';
import { hasNext, speedOf, transitionAfter, transitionChoice } from '../edit-ops';
import { fpsOf, mediaOf, type ClipView, type TimelineModel } from '../model';
import { SceneActions } from '../scene-actions';
import type { ShotLookup } from '../shot-frames';
import type { Edits } from '../use-edits';
import { GradePicture, type GradePictureProps } from './grade-picture';
import { MoreTile } from './more-tile';
import { gradeWords, holdWords, SCENE_TILE_HINTS, speedWords, TRANSITION_WORDS } from './more-words';
import { TransitionMotif } from './motifs';

export type SceneSurface = 'speed' | 'transition' | 'freeze' | 'colour' | 'why';

export interface SceneGroupProps {
  clip: ClipView | undefined;
  model: TimelineModel;
  /** The whole video's grade, drawn over the scene's in the Colour tile. */
  videoGrade: GradePictureProps['videoGrade'];
  edits: Edits;
  lookup: ShotLookup;
  open: SceneSurface | null;
  tileRef(surface: SceneSurface): Ref<HTMLButtonElement>;
  onOpen(surface: SceneSurface): void;
  onAddToChat(): void;
  /** The simple view's way back to its scenes, to pick one; absent where the timeline is on screen. */
  onScenes?: (() => void) | undefined;
  /** Comment on the scene, after its own actions. */
  comments?: ReactNode;
  className?: string;
}

export function SceneGroup({
  clip,
  model,
  videoGrade,
  edits,
  lookup,
  open,
  tileRef,
  onOpen,
  onAddToChat,
  onScenes,
  comments,
  className,
}: SceneGroupProps) {
  const { t, i18n } = useLingui();
  const time = useTimecode();
  const titleId = useId();
  const lineId = useId();
  const locked = !!clip?.item.locked;
  const photo = !!clip && clip.item.media.kind !== 'video';
  const held = !!clip?.item.holdFrame;
  const paused = !!clip && !!edits.aiPaused;
  // The whole group waits: no scene, a locked one, or the AI at work. Its one line says which.
  const waits = !clip || locked || paused;
  // Why Speed has nothing to offer, in the value's place. Short: a tile keeps to two lines in the lower panel.
  const noSpeed = {
    photo: t({ message: 'A photo has none', comment: 'Under "Speed" on a tile: a photo has no speed' }),
    hold: t({ message: 'A hold has none', comment: 'Under "Speed" on a tile: a held moment has no speed' }),
  };
  const media = clip ? mediaOf(clip.item) : null;
  const still = media ? (lookup.frameNow(media.assetId, media.shotId)?.url ?? null) : null;
  const kind = clip ? transitionChoice(transitionAfter(model, clip)) : 'cut';
  const number = clip ? i18n.number(clip.number) : '';
  const shotType = clip?.slot?.intent.shotType;
  const seconds = clip ? Math.round(((clip.end - clip.start) / fpsOf(model.rate)) * 10) / 10 : 0;
  const graded = !!clip?.item.grade && !waits;
  const whose = clip?.chosenBy === 'ai' ? 'ai' : clip?.chosenBy === 'you' ? 'you' : 'neutral';
  const tile = (surface: SceneSurface) => ({
    id: surface,
    ref: tileRef(surface),
    open: open === surface,
    still: waits,
    describedBy: waits ? lineId : undefined,
    onOpen: () => onOpen(surface),
  });

  return (
    <section data-slot="more-scene" aria-labelledby={titleId} className={cn('min-w-0', className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3">
          <h2 id={titleId} className="m-0 type-card-title text-ink">
            {clip ? t`Scene ${number}` : t`This scene`}
            {clip && shotType ? (
              <span className="font-normal text-ink-2"> · {i18n._(SHOT_TYPE_LABELS[shotType])}</span>
            ) : null}
          </h2>
          {clip ? (
            <SceneActions compact clip={clip} edits={edits} onAddToChat={onAddToChat}>
              {comments}
            </SceneActions>
          ) : onScenes ? (
            <Button size="sm" variant="secondary" data-slot="more-pick-scene" onClick={onScenes}>
              {t`Back to scenes`}
            </Button>
          ) : null}
        </div>
        <p
          id={lineId}
          data-slot="more-scene-line"
          data-state={!clip ? 'none' : locked ? 'locked' : paused ? 'ai' : 'ready'}
          className="m-0 flex items-start gap-1.5 type-meta text-ink-2 tabular-nums"
        >
          {!clip ? (
            onScenes ? (
              t`Pick a scene to change its speed, transition and colour.`
            ) : (
              t`Select a scene on the timeline to change its speed, transition and colour.`
            )
          ) : locked ? (
            <>
              <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
              {t`Locked. Unlock it to change it.`}
            </>
          ) : paused ? (
            <>
              <AiMarkIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ai-strong" />
              {t`These wait while Taalcut edits this video.`}
            </>
          ) : (
            <>
              {time.clock(clip.start, model.rate)} · {time.length(clip.end - clip.start, model.rate)}
            </>
          )}
        </p>
      </div>
      <div
        data-slot="more-scene-tiles"
        className={cn(
          'grid grid-cols-1 content-start gap-1 min-[1280px]:gap-2 @lg:grid-cols-2',
          // An odd tile out takes the row; a sixth tile fills the grid and nothing else changes.
          '@lg:[&>*:last-child:nth-child(odd)]:col-span-2',
        )}
      >
        <MoreTile
          {...tile('speed')}
          family="time"
          icon={CONCEPT_ICONS.speed}
          name={t`Speed`}
          value={clip ? speedWords(i18n, speedOf(clip)) : i18n._(SCENE_TILE_HINTS.speed)}
          reason={waits ? null : photo ? noSpeed.photo : held ? noSpeed.hold : null}
        />
        <MoreTile
          {...tile('transition')}
          family="join"
          picture={<TransitionMotif kind={kind} className="h-auto w-6" />}
          name={t`Transition`}
          value={clip ? i18n._(TRANSITION_WORDS[kind]) : i18n._(SCENE_TILE_HINTS.transition)}
          reason={!waits && clip && !hasNext(model, clip) ? t`No next scene` : null}
        />
        <MoreTile
          {...tile('freeze')}
          dialog
          family="time"
          icon={CONCEPT_ICONS.freeze}
          name={held ? t`Held moment` : t`Freeze`}
          value={held ? holdWords(i18n, seconds) : i18n._(SCENE_TILE_HINTS.freeze)}
          reason={
            !waits && photo
              ? t({
                  message: 'Already still',
                  comment: 'Under "Freeze" on a tile: a photo has no moment to freeze',
                })
              : null
          }
        />
        <MoreTile
          {...tile('colour')}
          family="picture"
          icon={CONCEPT_ICONS.colour}
          // Once the scene has a grade, the chip is its own frame under it: the value, seen.
          picture={
            graded ? (
              <GradePicture
                still={still}
                grade={clip?.item.grade}
                videoGrade={videoGrade}
                className="size-full"
              />
            ) : undefined
          }
          name={t`Colour`}
          value={clip ? gradeWords(i18n, clip.item.grade) : i18n._(SCENE_TILE_HINTS.colour)}
        />
        <MoreTile
          {...tile('why')}
          dialog
          // It only reads, so a locked scene and the AI at work leave it open.
          still={!clip}
          describedBy={clip ? undefined : lineId}
          family={whose}
          // Violet and its mark for the AI's pick; teal and the swap for yours.
          icon={whose === 'ai' ? AiMarkIcon : whose === 'you' ? VERB_ICONS.swap : CONCEPT_ICONS.clip}
          name={t`Why this shot`}
          value={
            !clip
              ? i18n._(SCENE_TILE_HINTS.why)
              : whose === 'ai'
                ? t`Taalcut picked this`
                : whose === 'you'
                  ? t`You changed this`
                  : t`About the shot this scene plays`
          }
          trailing={
            clip?.chosenBy === 'ai' && clip.cast ? (
              <Confidence value={clip.cast.confidence} className="shrink-0" />
            ) : null
          }
        />
      </div>
    </section>
  );
}
