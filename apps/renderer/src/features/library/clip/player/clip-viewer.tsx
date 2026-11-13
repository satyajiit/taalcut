// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the clip viewer · genre: atmospheric studio app (the viewer) · system: DESIGN.md v0.5
 * footage first: the clip plays at its own shape (a tall stage bound by the window's height for vertical and square
 *   clips, 16:9 for wide ones), the picture fitted inside by container units and lifted off the stage by a shadow,
 *   the space around it the clip's own light (clip-backdrop.tsx). Pressing the picture plays and pauses it; a
 *   double press fills the screen
 * states: playing · paused · loading (the shot's best frame until the first frame decodes, then the video) ·
 *   buffering (a neutral spinner in the corner) · can't play yet (the copy being made, or made again after the media
 *   cache let it go: the best frame and a plate saying why; the original away: the notice under the viewer says where
 *   it is) · failed (the copy couldn't be made: the cause) · no copy or the copy didn't load (the plate with Analyse
 *   again: the Button's states) · photo (the still) · no picture at all (the stage)
 * contrast: the plate is raised with ink and ink-2 (≥ 7:1 in both themes), its icon's tone carries no meaning alone
 * motion: the poster fades out over --dur-short when the video shows; a new still fades in; reduced motion fades
 */
import { useLingui } from '@lingui/react/macro';
import type { TaalcutError } from '@taalcut/core';
import { Button, cn, ErrorLine } from '@taalcut/ui';
import { CircleAlert, Film, ImageOff, LoaderCircle } from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { CLIP_FRAME_TRANSITION } from '../clip-transition';
import { ClipBackdrop } from './clip-backdrop';
import type { ClipPlayer } from './use-clip-player';
import type { ViewerState } from './viewer-state';

/** Analyse the clip again: the viewer's fix when the copy to play is gone. */
export interface Reanalyse {
  run: () => void;
  pending: boolean;
  /** Asking didn't work: why. */
  error: TaalcutError | null;
}

export interface ClipViewerProps {
  player: ClipPlayer;
  state: ViewerState;
  /** The copy to play's address (the media host), or null. */
  src: string | null;
  /** The best frame of the shot at the playhead (else the clip's), shown until the video shows and as the backdrop. */
  still: string | null;
  /** Width over height. */
  ratio: number;
  /** The clip's name: the picture's accessible name. */
  label: string;
  /** Filling the screen: the stage takes the column's height. */
  fill: boolean;
  onToggleFullscreen: () => void;
  /** Analyse again, when only a new copy to play helps. */
  reanalyse: Reanalyse | null;
  /** View Transitions name shared with the Library tile. */
  transitionName?: string;
}

function Plate({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div
      data-slot="clip-viewer-message"
      className="absolute inset-x-3 bottom-3 mx-auto flex max-w-[30rem] items-start gap-2.5 rounded-lg bg-raised px-3.5 py-3 text-sm text-ink shadow-md"
    >
      {icon}
      <div className="flex min-w-0 flex-col items-start gap-2">{children}</div>
    </div>
  );
}

const ICON = 'mt-0.5 size-4 shrink-0';

function ViewerMessage({ state, reanalyse }: Pick<ClipViewerProps, 'state' | 'reanalyse'>) {
  const { t } = useLingui();
  const again = reanalyse ? (
    <>
      <Button
        size="sm"
        variant="secondary"
        loading={reanalyse.pending}
        status={reanalyse.error ? 'error' : undefined}
        onClick={reanalyse.run}
      >
        {t`Analyse again`}
      </Button>
      {reanalyse.error ? <ErrorLine error={reanalyse.error} /> : null}
    </>
  ) : null;
  switch (state.kind) {
    case 'preparing':
      return (
        <Plate icon={<LoaderCircle aria-hidden className={cn(ICON, 'animate-spin text-ink-2')} />}>
          <p className="m-0">{t`Taalcut is making a copy of this clip to play. Its best frames show meanwhile.`}</p>
        </Plate>
      );
    case 'again':
      return (
        <Plate icon={<LoaderCircle aria-hidden className={cn(ICON, 'animate-spin text-ink-2')} />}>
          <p className="m-0">{t`The copy to play was let go to save space. Taalcut is making it again.`}</p>
        </Plate>
      );
    case 'proxyFailed':
      return (
        <Plate icon={<CircleAlert aria-hidden className={cn(ICON, 'text-danger-strong')} />}>
          <p className="m-0">{t`Taalcut couldn’t make a copy of this clip to play.`}</p>
          {state.error ? <ErrorLine error={state.error} /> : null}
        </Plate>
      );
    case 'noCopy':
      return (
        <Plate icon={<Film aria-hidden className={cn(ICON, 'text-ink-2')} />}>
          <p className="m-0">{t`There’s no copy of this clip to play any more. Analyse it again to make one.`}</p>
          {again}
        </Plate>
      );
    case 'broken':
      return (
        <Plate icon={<CircleAlert aria-hidden className={cn(ICON, 'text-danger-strong')} />}>
          {state.source === 'proxy' ? (
            <>
              <p className="m-0">{t`The copy of this clip to play didn’t load. Analyse it again to make a new one.`}</p>
              {again}
            </>
          ) : (
            <p className="m-0">{t`The original didn’t load. Check that its drive is connected.`}</p>
          )}
        </Plate>
      );
    default:
      return null;
  }
}

export function ClipViewer(props: ClipViewerProps) {
  const { player, state, src, still, ratio, label, fill, onToggleFullscreen, transitionName } = props;
  const { t } = useLingui();
  const [stillShown, setStillShown] = useState<string | null>(null);
  const wide = ratio > 1.2;
  const playing = state.kind === 'playable' && src !== null;
  const videoShown = playing && player.state.shown;

  return (
    <figure
      data-slot="clip-viewer"
      data-shape={wide ? 'wide' : 'tall'}
      data-state={state.kind}
      className={cn(
        'relative m-0 w-full overflow-hidden rounded-xl bg-viewer [container-type:size]',
        fill
          ? 'min-h-0 flex-1 rounded-none'
          : wide
            ? 'aspect-video max-h-[calc(100dvh-23rem)] min-h-56'
            : 'h-[clamp(16rem,calc(100dvh-23rem),46rem)]',
      )}
      style={{ '--frame-ratio': String(ratio) } as CSSProperties}
    >
      <ClipBackdrop src={still} />
      <div
        data-slot="clip-frame"
        className={cn(
          'absolute inset-0 m-auto overflow-hidden rounded-md bg-viewer shadow-lg',
          'aspect-(--frame-ratio) w-[min(calc(100cqw_-_2.5rem),calc((100cqh_-_2.5rem)*var(--frame-ratio)))]',
          CLIP_FRAME_TRANSITION,
        )}
        style={transitionName ? { viewTransitionName: transitionName } : undefined}
      >
        {playing ? (
          <video
            ref={player.videoRef}
            src={src}
            preload="auto"
            playsInline
            tabIndex={-1}
            // Its name is the file's, shown as written.
            translate="no"
            aria-label={label}
            onClick={player.toggle}
            onDoubleClick={onToggleFullscreen}
            data-slot="clip-video"
            className="absolute inset-0 size-full cursor-pointer object-contain"
          />
        ) : null}
        {still && !videoShown ? (
          <img
            key={still}
            src={still}
            alt={playing ? '' : label}
            translate="no"
            draggable={false}
            decoding="async"
            onLoad={() => setStillShown(still)}
            data-shown={stillShown === still || undefined}
            className="pointer-events-none absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-(--dur-short) ease-(--ease-out) data-[shown]:opacity-100"
          />
        ) : null}
        {!still && !playing ? (
          <span
            role="img"
            aria-label={t`No picture yet`}
            className="absolute inset-0 grid place-items-center"
          >
            <ImageOff aria-hidden className="size-6 text-viewer-rule" />
          </span>
        ) : null}
        {playing && player.state.buffering && player.state.playing ? (
          <span role="status" className="absolute top-2 right-2 rounded-pill bg-raised p-1 shadow-sm">
            <LoaderCircle aria-hidden className="size-4 animate-spin text-ink-2" />
            <span className="sr-only">{t`Loading the next frames`}</span>
          </span>
        ) : null}
      </div>
      <ViewerMessage state={state} reanalyse={props.reanalyse} />
    </figure>
  );
}
