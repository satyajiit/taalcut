// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · page body: a clip, loaded · genre: atmospheric studio app · system: DESIGN.md v0.5 (UX2)
 * macrostructure (app page, the editor's family; a review tool's player and inspector): footage first on the
 *   leading side, the clip playing at its own shape over its transport and scrubber, held in view while the page
 *   scrolls; beside it the inspector to read down: what Taalcut saw, how far it has got (unless it's done), the shot
 *   at the playhead, the facts in groups, what's said, and last, once it's all done, one quiet line. Below 42rem of
 *   page it all stacks, player first. One playhead (a clock outside React) drives it all: the video, the scrubber,
 *   the shot, the line being said; the keys reach it from anywhere on the page
 * motion: the inspector's sections enter as one cascade (8 px rise and fade, StaggerGroup), the page's one
 *   orchestrated entrance (DESIGN.md v0.5); the playhead glides on a jump; the shot crossfades; reduced motion fades
 */
import type { I18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { AssetDetail, TaalcutError } from '@taalcut/core';
import { StaggerGroup, StaggerItem } from '@taalcut/ui';
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMediaUrls } from '../../../services/provider';
import { ToolbarActions } from '../../../shell/toolbar';
import { formatLanguage } from '../../shared/format';
import { indexingReasonText } from '../indexing-messages';
import { ClipActions } from './clip-actions';
import { analysisOf, pending, skipReason, soundOf } from './clip-facts-data';
import { clipLength, shotSpans, speechSpans, stepShot, textSpans } from './clip-time';
import { ClipTranscript } from './clip-transcript';
import { ClipFacts } from './inspector/clip-facts';
import { ClipShotNow } from './inspector/clip-shot-now';
import { ClipStatus, type RetryKind } from './inspector/clip-status';
import { ClipSummary } from './inspector/clip-summary';
import { ClipStage } from './player/clip-stage';
import type { Reanalyse } from './player/clip-viewer';
import { useClipPlayer } from './player/use-clip-player';
import { analysisGroups, type AnalysisGroupKey } from './progress/analysis-groups';
import { StaleSection } from './progress/stale-section';
import { useFullscreen } from './player/use-fullscreen';
import { usePlayerKeys } from './player/use-player-keys';
import { frameMsOf, frameRatio, viewerState } from './player/viewer-state';

export interface ClipViewProps {
  detail: AssetDetail;
  onRetry?: (() => void) | undefined;
  /** What trying again does: the failed step again, or the whole clip from the start (see ClipStatus). */
  retryKind?: RetryKind;
  retrying?: boolean;
  /** Asking to try the failed stage again didn't work: why. */
  retryError?: TaalcutError | null;
  /** Analyse the clip again, when only a new copy to play can help the viewer. */
  reanalyse?: Reanalyse | null;
  /** The skeleton's stand-in: the layout without the window bar's actions, motion or media. */
  fixture?: boolean;
}

/**
 * False for the page's first frame, true just after (B18): the picture, the transport and the facts draw first, so
 * the tile's frame can grow into the viewer at once; the transcript and the filmstrip follow in a transition React
 * can interrupt, instead of one long task before anything shows.
 */
function useFirstFrameDrawn(): boolean {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => startTransition(() => setDrawn(true)), []);
  return drawn;
}

/** Why a clip has no shots: still to be split, or the library found none (in its words when it says). */
function noShotsWords(i18n: I18n, detail: AssetDetail): string {
  if (detail.stages.some((row) => row.stage === 'vision.shots' && row.state === 'failed'))
    return i18n._(msg`Taalcut couldn’t split this clip into shots.`);
  if (pending(detail, 'vision.shots')) return i18n._(msg`Taalcut hasn’t split this clip into shots yet.`);
  const reason = skipReason(detail, 'vision.shots');
  return (
    (reason ? indexingReasonText(i18n, reason) : undefined) ?? i18n._(msg`No shots were found in this clip.`)
  );
}

export function ClipView({
  detail,
  onRetry,
  retryKind = 'retry',
  retrying = false,
  retryError = null,
  reanalyse = null,
  fixture = false,
}: ClipViewProps) {
  const { t, i18n } = useLingui();
  const media = useMediaUrls();
  const { asset } = detail;
  const later = useFirstFrameDrawn() || fixture;
  const length = clipLength(detail);
  const spans = useMemo(() => shotSpans(detail.shots), [detail.shots]);
  const speech = useMemo(() => speechSpans(detail.transcript?.lines ?? []), [detail.transcript]);
  const text = useMemo(() => textSpans(detail.shots), [detail.shots]);
  const player = useClipPlayer(length, frameMsOf(detail), spans);
  const fullscreen = useFullscreen<HTMLDivElement>();
  const glide = useRef(false);
  const viewer = viewerState(detail, player.state.failed);
  const src = detail.playback ? media.playback(asset.id, detail.playback) : null;
  const photo = asset.kind === 'image' || length <= 0;

  const { seek, clock } = player;
  const seekTo = useCallback(
    (at: number) => {
      glide.current = true;
      seek(at);
    },
    [seek],
  );
  const toShot = useCallback(
    (direction: -1 | 1) => {
      const to = stepShot(spans, clock.get(), direction);
      if (to !== null) seekTo(to);
    },
    [spans, clock, seekTo],
  );
  usePlayerKeys(
    {
      toggle: player.toggle,
      shuttle: player.shuttle,
      pause: player.pause,
      stepFrame: player.stepFrame,
      stepShot: toShot,
      toggleMute: player.toggleMute,
      toggleLoop: player.toggleLoop,
      toggleFullscreen: fullscreen.toggle,
    },
    !fixture && !photo,
  );

  const sound = soundOf(detail);
  // LIB1-LANG: speech in a language nothing here writes out yet says so, by name.
  const unwritten =
    skipReason(detail, 'audio.transcript') === 'indexing.skip.cannotTranscribe' && detail.asset.language
      ? formatLanguage(i18n, detail.asset.language)
      : null;
  const absent =
    sound === 'silent'
      ? t`This clip has no sound.`
      : unwritten
        ? t`Taalcut can’t write out ${unwritten} speech yet.`
        : // A clip it listened to before (a transcript is kept) isn't one it hasn't listened to (LIB1-LANG).
          pending(detail, 'audio.') && !detail.transcript
          ? t`Taalcut hasn’t listened to this clip yet.`
          : sound === 'speech'
            ? // LIB1-LANG: speech was heard, but the transcriber wrote nothing down.
              t`Taalcut heard a little speech, too short or unclear to write down.`
            : t`No one speaks in this clip.`;
  const complete = analysisOf(detail).phase === 'complete';
  // Analyse again keeps the last results while it redoes them (LIB1-PROG): each part says so until its new one lands.
  const groups = useMemo(() => analysisGroups(detail), [detail]);
  const redoing = (...keys: AnalysisGroupKey[]) =>
    groups.some((group) => keys.includes(group.key) && group.stale);
  const status = (
    <ClipStatus
      detail={detail}
      onRetry={onRetry}
      retryKind={retryKind}
      retrying={retrying}
      retryError={retryError}
    />
  );

  return (
    <div
      data-slot="clip"
      className="grid items-start gap-8 @min-[42rem]:grid-cols-[minmax(0,1fr)_17rem] @min-[56rem]:grid-cols-[minmax(0,1fr)_20rem] @min-[72rem]:grid-cols-[minmax(0,1fr)_23rem]"
    >
      <ClipStage
        detail={detail}
        player={player}
        viewer={viewer}
        src={src}
        ratio={frameRatio(detail)}
        spans={spans}
        speech={speech}
        text={text}
        fullscreen={fullscreen}
        glide={glide}
        onSeek={seekTo}
        onStepShot={toShot}
        reanalyse={reanalyse}
        noShots={noShotsWords(i18n, detail)}
        fixture={fixture}
        later={later}
      />
      <StaggerGroup animate={!fixture} className="flex min-w-0 flex-col gap-8">
        <StaggerItem>
          <StaleSection stale={redoing('describe')}>
            <ClipSummary detail={detail} />
          </StaleSection>
        </StaggerItem>
        {complete ? null : <StaggerItem>{status}</StaggerItem>}
        {spans.length > 0 ? (
          <StaggerItem>
            <StaleSection stale={redoing('shots', 'picture')}>
              <ClipShotNow spans={spans} clock={clock} />
            </StaleSection>
          </StaggerItem>
        ) : null}
        <StaggerItem>
          <ClipFacts detail={detail} />
        </StaggerItem>
        {photo || !later ? null : (
          <StaggerItem>
            <StaleSection stale={redoing('sound')}>
              <ClipTranscript
                assetId={asset.id}
                preview={detail.transcript}
                absent={absent}
                clock={clock}
                spans={spans}
                onSeek={seekTo}
              />
            </StaleSection>
          </StaggerItem>
        )}
        {complete ? <StaggerItem>{status}</StaggerItem> : null}
      </StaggerGroup>
      {fixture ? null : (
        <ToolbarActions>
          <ClipActions detail={detail} />
        </ToolbarActions>
      )}
    </div>
  );
}
