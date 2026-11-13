// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the clip's transport · genre: atmospheric studio app (the viewer) · system: DESIGN.md v0.5
 * one row under the viewer, as an editor's: play in a neutral ink disc (marigold stays Make a video's), a frame and
 *   a shot back and on, the playhead's time in JetBrains Mono tabular figures over the clip's length, the shuttle's
 *   speed when J or L changed it, then loop the shot, sound and full screen. Every button names itself and its key
 *   in a tooltip (and aria-keyshortcuts)
 * states (each button): default · hover (hover surface; the disc ink-2) · focus (base ring, instant) · active (1 px
 *   press) · disabled (nothing to play yet; no shot before or after) · on (loop, muted: aria-pressed, the ink chip)
 *   · loading n/a (the viewer says it's buffering) · error (full screen refused: the button's error colours) ·
 *   success n/a (the picture answering is the success)
 * contrast: icons ink-2 on canvas ≥ 7:1, the disc canvas on ink ≥ 7:1, the length ink-3 ≥ 4.5:1
 */
import { useLingui } from '@lingui/react/macro';
import {
  Button,
  cn,
  ShortcutKeys,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useTimecode,
  useShortcutFormat,
} from '@taalcut/ui';
import {
  ChevronFirst,
  ChevronLast,
  Expand,
  Pause,
  Play,
  Repeat1,
  Shrink,
  StepBack,
  StepForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useClockTime, type ClipClock } from './clip-clock';
import { PLAYER_KEYS } from './use-player-keys';
import type { ClipPlayer } from './use-clip-player';

const MS = { num: 1000, den: 1 } as const;

interface TransportButtonProps {
  label: string;
  keys: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  error?: boolean;
  className?: string;
  children: ReactNode;
}

function TransportButton({
  label,
  keys,
  onClick,
  disabled,
  pressed,
  error,
  className,
  children,
}: TransportButtonProps) {
  const format = useShortcutFormat();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          aria-label={label}
          aria-keyshortcuts={format.aria(keys)}
          aria-pressed={pressed}
          disabled={disabled}
          status={error ? 'error' : undefined}
          onClick={onClick}
          className={cn(
            'size-8 disabled:border-transparent disabled:bg-transparent',
            pressed && 'bg-inverse text-on-inverse hover:bg-inverse hover:text-on-inverse hover:opacity-90',
            className,
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        {label}
        <ShortcutKeys
          accelerator={keys}
          className="[&_kbd]:border-tooltip-rule [&_kbd]:bg-tooltip [&_kbd]:text-on-tooltip"
        />
      </TooltipContent>
    </Tooltip>
  );
}

/** The playhead's time over the clip's length: the only part of the row that redraws while it plays. */
function Readout({ clock, length, shuttle }: { clock: ClipClock; length: number; shuttle: number }) {
  const { t, i18n } = useLingui();
  const timecode = useTimecode();
  const at = useClockTime(clock);
  const clockText = (ms: number) => timecode.clock(Math.round(ms), MS, { fraction: true });
  const speed = i18n.number(Math.abs(shuttle));
  return (
    <p className="m-0 flex min-w-0 items-baseline gap-1.5 font-mono text-sm" data-slot="clip-timecode">
      <span className="text-ink tabular-nums">{clockText(at)}</span>
      <span className="text-ink-3">/</span>
      <span className="text-ink-3 tabular-nums">{clockText(length)}</span>
      {shuttle !== 0 && shuttle !== 1 ? (
        <span
          data-slot="clip-shuttle"
          className="ms-1 rounded-sm bg-chip px-1.5 font-sans text-2xs font-semibold text-ink-2 tabular-nums"
        >
          {shuttle < 0 ? t`Backwards ${speed}×` : t`${speed}×`}
        </span>
      ) : null}
    </p>
  );
}

export interface ClipTransportProps {
  player: ClipPlayer;
  /** There is a copy to play (else only the playhead moves, over the shots' frames). */
  playable: boolean;
  hasSound: boolean;
  previousShot: number | null;
  nextShot: number | null;
  onSeek: (at: number) => void;
  fullscreen: { active: boolean; refused: boolean; toggle: () => void };
}

export function ClipTransport({
  player,
  playable,
  hasSound,
  previousShot,
  nextShot,
  onSeek,
  fullscreen,
}: ClipTransportProps) {
  const { t } = useLingui();
  const format = useShortcutFormat();
  const { state } = player;
  const playLabel = state.playing ? t`Pause` : t`Play`;
  return (
    <div data-slot="clip-transport" className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1">
      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              aria-label={playLabel}
              aria-keyshortcuts={format.aria(PLAYER_KEYS.play)}
              disabled={!playable || !state.ready}
              onClick={player.toggle}
              data-slot="clip-play"
              className="me-1 rounded-pill bg-inverse text-on-inverse hover:bg-inverse hover:text-on-inverse hover:opacity-90 active:bg-inverse disabled:border-transparent disabled:bg-sunken"
            >
              {state.playing ? (
                <Pause aria-hidden className="fill-current" />
              ) : (
                <Play aria-hidden className="ms-0.5 fill-current" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="flex items-center gap-2">
            {playLabel}
            <ShortcutKeys
              accelerator={PLAYER_KEYS.play}
              className="[&_kbd]:border-tooltip-rule [&_kbd]:bg-tooltip [&_kbd]:text-on-tooltip"
            />
          </TooltipContent>
        </Tooltip>
        <TransportButton
          label={t`Previous shot`}
          keys={PLAYER_KEYS.previousShot}
          disabled={previousShot === null}
          onClick={() => previousShot !== null && onSeek(previousShot)}
        >
          <ChevronFirst aria-hidden />
        </TransportButton>
        <TransportButton
          label={t`Back one frame`}
          keys={PLAYER_KEYS.backFrame}
          onClick={() => player.stepFrame(-1)}
        >
          <StepBack aria-hidden />
        </TransportButton>
        <TransportButton
          label={t`On one frame`}
          keys={PLAYER_KEYS.nextFrame}
          onClick={() => player.stepFrame(1)}
        >
          <StepForward aria-hidden />
        </TransportButton>
        <TransportButton
          label={t`Next shot`}
          keys={PLAYER_KEYS.nextShot}
          disabled={nextShot === null}
          onClick={() => nextShot !== null && onSeek(nextShot)}
        >
          <ChevronLast aria-hidden />
        </TransportButton>
      </div>
      <Readout clock={player.clock} length={player.length} shuttle={state.shuttle} />
      <div className="ms-auto flex items-center gap-0.5">
        <TransportButton
          label={t`Loop this shot`}
          keys={PLAYER_KEYS.loop}
          pressed={state.looping}
          disabled={!playable}
          onClick={player.toggleLoop}
        >
          <Repeat1 aria-hidden />
        </TransportButton>
        <TransportButton
          label={state.muted ? t`Turn the sound on` : t`Mute`}
          keys={PLAYER_KEYS.mute}
          pressed={state.muted}
          disabled={!playable || !hasSound}
          onClick={player.toggleMute}
        >
          {state.muted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
        </TransportButton>
        <TransportButton
          label={fullscreen.active ? t`Leave full screen` : t`Full screen`}
          keys={PLAYER_KEYS.fullscreen}
          error={fullscreen.refused}
          onClick={fullscreen.toggle}
        >
          {fullscreen.active ? <Shrink aria-hidden /> : <Expand aria-hidden />}
        </TransportButton>
      </div>
    </div>
  );
}
