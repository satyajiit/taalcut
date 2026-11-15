// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One shot of the other-shots panel (EDT2) as a 9:16 frame on the viewer grey, as the cast board frames its shots:
 * the moment the shot would start from, drawn from its file's filmstrip, or the shot's own thumbnail until the
 * filmstrip is there (and for a file without one). Under the pointer or focus it flips through the stretch the clip
 * would play, at that stretch's own pace, from the same filmstrip: no video is decoded. Who chose what plays now
 * rides on the frame's lower edge (the AI mark or "You"), with a marigold ring round it.
 * states: empty (the grey) · still · playing (the filmstrip's frames in turn; never under reduced motion, never
 *   with fewer than two frames in the stretch) · current (ring and mark) · dimmed (its swap is on its way)
 */
import { useLingui } from '@lingui/react/macro';
import type { CastCandidate } from '@taalcut/core';
import { AiMark, cn, useReducedMotion } from '@taalcut/ui';
import { useEffect, useMemo, useState } from 'react';
import { frameStyle, frameTimesMs, nearestFrame, useSpriteLoad } from '../../library/clip/scrubber/sprite';
import type { ShotLookup } from '../shot-frames';
import { startMs } from './shot-options';

/** The frame's size on screen, px (9:16). */
export const OPTION_FRAME = { width: 64, height: 114 } as const;
/** The quickest the frames turn, ms. */
const MIN_STEP_MS = 80;

export interface OptionFrameProps {
  candidate: CastCandidate;
  lookup: ShotLookup;
  /** How long the clip plays, ms: the stretch to flip through. */
  sceneMs: number;
  /** Under the pointer or focus. */
  playing: boolean;
  /** Who chose it, on what plays now. */
  marker?: 'ai' | 'you' | null;
  current?: boolean;
  dimmed?: boolean;
}

export function OptionFrame({
  candidate,
  lookup,
  sceneMs,
  playing,
  marker = null,
  current = false,
  dimmed = false,
}: OptionFrameProps) {
  const { t } = useLingui();
  const reduced = useReducedMotion() === true;
  const strip = lookup.strip(candidate.assetId);
  const still = lookup.frameNow(candidate.assetId, candidate.shotId)?.url ?? null;
  const load = useSpriteLoad(strip?.src ?? null);
  const filmstrip = strip?.filmstrip;
  const times = useMemo(() => (filmstrip ? frameTimesMs(filmstrip) : []), [filmstrip]);
  const from = startMs(candidate);
  const first = filmstrip ? nearestFrame(times, from) : 0;
  const frames = filmstrip ? nearestFrame(times, from + sceneMs) - first + 1 : 1;
  const moving = playing && !reduced && load === 'ready' && frames > 1;
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!moving) return;
    setStep(0);
    const timer = window.setInterval(
      () => setStep((now) => (now + 1) % frames),
      Math.max(MIN_STEP_MS, sceneMs / frames),
    );
    return () => window.clearInterval(timer);
  }, [moving, frames, sceneMs]);

  return (
    <span data-slot="option-frame" className="relative block shrink-0" style={{ width: OPTION_FRAME.width }}>
      <span
        className={cn(
          'tc-viewer relative block overflow-hidden rounded-md transition-opacity duration-(--dur-short) ease-(--ease-out)',
          current && 'ring-2 ring-primary-strong ring-offset-1 ring-offset-overlay',
          dimmed && 'opacity-50',
        )}
        style={{ height: OPTION_FRAME.height }}
      >
        {still ? (
          <img
            src={still}
            alt=""
            draggable={false}
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
        ) : null}
        {strip && load === 'ready' ? (
          <span
            data-frame={first + (moving ? step : 0)}
            data-playing={moving || undefined}
            className="absolute inset-0"
            style={frameStyle(strip.filmstrip, strip.src, first + (moving ? step : 0), OPTION_FRAME)}
          />
        ) : null}
      </span>
      {marker === 'ai' ? (
        <span className="absolute -bottom-1.5 left-1/2 inline-flex h-4 -translate-x-1/2 items-center rounded-pill bg-raised px-1 ring-1 ring-rule-subtle">
          <AiMark label={t`AI pick`} className="size-2.5" />
        </span>
      ) : marker === 'you' ? (
        <span className="absolute -bottom-1.5 left-1/2 inline-flex h-4 -translate-x-1/2 items-center rounded-pill bg-you-soft px-1.5 text-2xs leading-none font-semibold text-you-strong ring-1 ring-raised">
          {t`You`}
        </span>
      ) : null}
    </span>
  );
}
