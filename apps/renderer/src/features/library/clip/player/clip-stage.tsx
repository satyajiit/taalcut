// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the clip page's player column · genre: atmospheric studio app (the viewer and its timeline)
 * system: DESIGN.md v0.5 · footage first, held in view while the inspector scrolls: the viewer, anything in the way
 *   of using the clip said under it (clip-notices.tsx), the transport, then the scrubber. Full screen takes the whole
 *   column onto the canvas, the viewer growing to fill it, so the transport and scrubber stay at hand
 * states: the parts' own (clip-viewer, clip-transport, clip-scrubber) · photo (the viewer alone) · full screen
 */
import { useLingui } from '@lingui/react/macro';
import type { AssetDetail } from '@taalcut/core';
import { cn } from '@taalcut/ui';
import { useCallback, type ReactNode, type RefObject } from 'react';
import { useMediaUrls } from '../../../../services/provider';
import { ClipNotices } from '../clip-notices';
import { clipTransitionName } from '../clip-transition';
import { shotAt, stepShot, type ShotSpan, type TextSpan } from '../clip-time';
import { ClipScrubber } from '../scrubber/clip-scrubber';
import { filmstripState } from '../scrubber/filmstrip-state';
import { useClockValue } from './clip-clock';
import { ClipTransport } from './clip-transport';
import { ClipViewer, type Reanalyse } from './clip-viewer';
import type { ClipPlayer } from './use-clip-player';
import type { useFullscreen } from './use-fullscreen';
import type { ViewerState } from './viewer-state';

export interface ClipStageProps {
  detail: AssetDetail;
  player: ClipPlayer;
  viewer: ViewerState;
  src: string | null;
  ratio: number;
  spans: readonly ShotSpan[];
  speech: readonly TextSpan[];
  text: readonly TextSpan[];
  fullscreen: ReturnType<typeof useFullscreen<HTMLDivElement>>;
  glide: RefObject<boolean>;
  onSeek: (at: number) => void;
  onStepShot: (direction: -1 | 1) => void;
  reanalyse: Reanalyse | null;
  noShots: ReactNode;
  /** The skeleton's stand-in: the shapes only. */
  fixture: boolean;
  /** False for the page's first frame: the filmstrip's empty frame holds its place until the next (B18). */
  later?: boolean;
}

export function ClipStage(props: ClipStageProps) {
  const { detail, player, viewer, src, ratio, spans, speech, text, fullscreen, glide, onSeek, onStepShot } =
    props;
  const { t } = useLingui();
  const media = useMediaUrls();
  const { asset } = detail;
  const photo = asset.kind === 'image' || player.length <= 0;
  const shotIndex = useClockValue(
    player.clock,
    useCallback((at: number) => shotAt(spans, at)?.index ?? -1, [spans]),
  );
  const thumbnail = spans[shotIndex]?.shot.thumbnail ?? asset.thumbnail;
  const still = thumbnail ? media.derived(thumbnail) : null;
  const previous = useClockValue(
    player.clock,
    useCallback((at: number) => stepShot(spans, at, -1), [spans]),
  );
  const next = useClockValue(
    player.clock,
    useCallback((at: number) => stepShot(spans, at, 1), [spans]),
  );
  const playable = viewer.kind === 'playable';

  return (
    <div
      ref={fullscreen.ref}
      data-slot="clip-player"
      data-fullscreen={fullscreen.active || undefined}
      className={cn(
        'flex min-w-0 flex-col gap-3',
        fullscreen.active ? 'h-dvh bg-canvas p-6' : '@min-[42rem]:sticky @min-[42rem]:top-6',
      )}
    >
      <ClipViewer
        player={player}
        state={props.fixture ? { kind: 'photo' } : viewer}
        src={props.fixture ? null : src}
        still={props.fixture ? null : still}
        ratio={ratio}
        label={photo ? t`The photo` : asset.name}
        fill={fullscreen.active}
        onToggleFullscreen={fullscreen.toggle}
        reanalyse={props.reanalyse}
        {...(props.fixture ? {} : { transitionName: clipTransitionName(asset.id) })}
      />
      {fullscreen.active ? null : <ClipNotices detail={detail} />}
      {photo ? null : (
        <>
          <ClipTransport
            player={player}
            playable={playable}
            hasSound={detail.facts?.hasAudio ?? false}
            previousShot={previous}
            nextShot={next}
            onSeek={onSeek}
            fullscreen={fullscreen}
          />
          <ClipScrubber
            player={player}
            filmstrip={props.fixture || props.later === false ? null : filmstripState(detail)}
            spans={spans}
            speech={speech}
            text={text}
            waveform={detail.waveform}
            beats={detail.beats}
            ratio={ratio}
            onSeek={onSeek}
            onStepShot={onStepShot}
            glide={glide}
            noShots={props.noShots}
          />
        </>
      )}
    </div>
  );
}
