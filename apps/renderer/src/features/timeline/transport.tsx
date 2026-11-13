// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · Operate · component: transport (UX4) · system: DESIGN.md v0.6 + UX4 (icon registry, tooltips)
 * one quiet row between the viewer and the bed, always on screen: play or pause (Space), where the playhead is and
 *   how long the film runs in mono figures, which beat it's on in plain words ("Beat 5 of 32", not bars and BPM),
 *   the edit tools (Undo, Redo, a beat shorter or longer: `tools`), then the zoom (Fit, out, in: ⌘− ⌘=); neutral
 *   ghost buttons with the registry's glyphs and tooltips, the screen's one marigold fill stays "Export…"
 * states: buttons carry the eight (default, hover, focus, active, disabled at the zoom's ends, loading n/a,
 *   error/success: the editor's line under it) · playing (the button reads Pause) · the figures update without a
 *   render (written straight to the DOM per frame) */
import { useLingui } from '@lingui/react/macro';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useShortcutFormat,
  useTimecode,
  VERB_ICONS,
} from '@taalcut/ui';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useEffectEvent, useRef, type ReactNode } from 'react';
import { ACCELERATORS, KEYS } from './keys';
import { barBeat, type TimelineModel } from './model';
import { usePlayheadFrame, usePlaying, type Playhead } from './playhead';

export const ZOOMS = [1, 1.5, 2, 3, 4, 6, 8] as const;

export interface TransportProps {
  model: TimelineModel;
  playhead: Playhead;
  zoomIndex: number;
  onZoom: (index: number) => void;
  /** The edit tools (Undo, Redo, the trims), after where the playhead is. */
  tools?: ReactNode;
  detailed?: boolean;
}

export function Transport({ model, playhead, zoomIndex, onZoom, tools, detailed = true }: TransportProps) {
  const { t, i18n } = useLingui();
  const shortcut = useShortcutFormat();
  const zoomOutKeys = shortcut.text(ACCELERATORS.zoomOut);
  const zoomInKeys = shortcut.text(ACCELERATORS.zoomIn);
  const time = useTimecode();
  const playing = usePlaying(playhead);
  const now = useRef<HTMLSpanElement>(null);
  const beat = useRef<HTMLSpanElement>(null);
  const shown = useRef({ clock: '', beat: '' });

  const paint = (frame: number) => {
    const clock = time.clock(frame, model.rate);
    if (clock !== shown.current.clock && now.current) {
      shown.current.clock = clock;
      now.current.textContent = clock;
    }
    const at = barBeat(model, frame);
    let words = '';
    if (at) {
      // The running count of beats, not bars: creators count beats (PRODUCT.md: no jargon).
      const beatNumber = i18n.number((at.bar - 1) * model.beatsPerBar + at.beat);
      const beatTotal = i18n.number(model.beats.length);
      words = t`Beat ${beatNumber} of ${beatTotal}`;
    }
    if (words !== shown.current.beat && beat.current) {
      shown.current.beat = words;
      beat.current.textContent = words;
    }
  };
  usePlayheadFrame(playhead, paint);
  // The figures are written per frame, not per render: a language switch (P3-L2) writes them again in its words.
  const repaint = useEffectEvent(() => paint(playhead.frame()));
  useEffect(() => repaint(), [i18n.locale]);

  const total = time.clock(model.total, model.rate);
  return (
    <div data-slot="transport" className="flex h-11 shrink-0 items-center gap-2 px-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label={playing ? t`Pause` : t`Play`}
            aria-keyshortcuts={KEYS.play}
            data-slot="play"
            data-playing={playing || undefined}
            icon={playing ? VERB_ICONS.pause : VERB_ICONS.play}
            onClick={() => playhead.toggle()}
          />
        </TooltipTrigger>
        <TooltipContent>
          {playing ? t`Pause` : t`Play`}
          <kbd className="ms-2 font-sans text-on-tooltip">{t`Space`}</kbd>
        </TooltipContent>
      </Tooltip>
      <p
        className="m-0 flex items-baseline gap-1 font-mono text-sm text-ink tabular-nums"
        data-slot="timecode"
      >
        <span ref={now}>{time.clock(playhead.frame(), model.rate)}</span>
        <span className="text-ink-3">/</span>
        <span className="text-ink-2">{total}</span>
      </p>
      <span
        ref={beat}
        data-slot="bar-beat"
        className="hidden type-meta whitespace-nowrap text-ink-3 tabular-nums min-[1440px]:inline"
      />
      {tools ? <span aria-hidden className="mx-1.5 h-4 w-px shrink-0 bg-rule" /> : null}
      {tools}
      {detailed ? (
        <div className="ml-auto flex items-center gap-0.5" role="group" aria-label={t`Zoom`}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 disabled:border-transparent disabled:bg-transparent"
                disabled={zoomIndex === 0}
                icon={Maximize2}
                onClick={() => onZoom(0)}
              >
                {t`Fit`}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t`Fit the whole video`}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-8 disabled:border-transparent disabled:bg-transparent"
                aria-label={t`Zoom out`}
                aria-keyshortcuts={shortcut.aria(ACCELERATORS.zoomOut)}
                disabled={zoomIndex === 0}
                icon={ZoomOut}
                onClick={() => onZoom(zoomIndex - 1)}
              />
            </TooltipTrigger>
            <TooltipContent>
              {t`Zoom out`}
              <kbd className="ms-2 font-sans text-on-tooltip">{zoomOutKeys}</kbd>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-8 disabled:border-transparent disabled:bg-transparent"
                aria-label={t`Zoom in`}
                aria-keyshortcuts={shortcut.aria(ACCELERATORS.zoomIn)}
                disabled={zoomIndex === ZOOMS.length - 1}
                icon={ZoomIn}
                onClick={() => onZoom(zoomIndex + 1)}
              />
            </TooltipTrigger>
            <TooltipContent>
              {t`Zoom in`}
              <kbd className="ms-2 font-sans text-on-tooltip">{zoomInKeys}</kbd>
            </TooltipContent>
          </Tooltip>
        </div>
      ) : null}
    </div>
  );
}
