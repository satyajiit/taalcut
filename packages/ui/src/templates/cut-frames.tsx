// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the cut, as the frame before and the frame after (BRK1-REV) · system: DESIGN.md
 *   v0.7 (footage on the viewer grey, at its own shape; nothing of the app's on it)
 * two frames side by side at the reel's shape: the last one before the cut and the first one after, so a cut that
 *   isn't one (the same shot on both sides) is plain to see. From the kept reel, each a paused <video> seeked half a
 *   frame inside its side of the cut (exact, and it follows a cut you move); without the reel, the contact sheet's
 *   nearest frame on each side
 * states: loading (the viewer grey until the frame is there) · ready · no reel (the sheet's frames) · nothing to
 *   show (no reel and no sheet: the grey with no frame)
 * motion: none
 */
import { useLingui } from '@lingui/react/macro';
import type { Template } from '@taalcut/core';
import { useEffect, useRef } from 'react';
import { frameSeconds } from './cut-math';
import { sheetTileStyle } from './sheet-tile';
import { toSeconds } from './slot-words';

export interface CutFramesProps {
  template: Template;
  /** Where the cut is, in seconds (a cut being moved shows its new place). */
  cut: number;
  reelUrl: string | null;
  sheetUrl: string | null;
  /** The frames' height in px. */
  height?: number;
}

/** A paused frame of the reel at `seconds`. */
function ReelFrame({
  url,
  seconds,
  width,
  height,
}: {
  url: string;
  seconds: number;
  width: number;
  height: number;
}) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const seek = () => {
      el.currentTime = Math.max(0, seconds);
    };
    if (el.readyState >= 1) seek();
    else el.addEventListener('loadedmetadata', seek, { once: true });
    return () => el.removeEventListener('loadedmetadata', seek);
  }, [seconds, url]);
  return (
    <video
      ref={video}
      src={url}
      muted
      playsInline
      preload="auto"
      tabIndex={-1}
      aria-hidden
      className="block rounded-sm bg-viewer object-cover"
      style={{ width, height }}
    />
  );
}

/** The contact sheet's frame nearest `seconds` on one side of the cut. */
function sheetFrame(template: Template, cut: number, side: 'before' | 'after'): number | null {
  const sheet = template.contactSheet;
  if (!sheet) return null;
  let best: number | null = null;
  sheet.frames.forEach((frame, index) => {
    const at = toSeconds(frame.at);
    if (side === 'before' ? at >= cut : at < cut) return;
    if (best === null) best = index;
    else {
      const was = toSeconds(sheet.frames[best]!.at);
      if (side === 'before' ? at > was : at < was) best = index;
    }
  });
  return best;
}

export function CutFrames({ template, cut, reelUrl, sheetUrl, height = 96 }: CutFramesProps) {
  const { t } = useLingui();
  const ratio = template.canvas.width / template.canvas.height;
  const width = Math.round(height * ratio);
  const half = frameSeconds(template) / 2;
  const sheet = template.contactSheet;
  const side = (which: 'before' | 'after') => {
    if (reelUrl)
      return (
        <ReelFrame
          url={reelUrl}
          seconds={which === 'before' ? cut - half : cut + half}
          width={width}
          height={height}
        />
      );
    const index = sheetFrame(template, cut, which);
    return (
      <span
        aria-hidden
        className="block rounded-sm bg-viewer bg-no-repeat"
        style={
          sheet && index !== null && sheetUrl
            ? { ...sheetTileStyle(sheet, sheetUrl, width, height, index), width, height }
            : { width, height }
        }
      />
    );
  };
  return (
    <div data-slot="cut-frames" data-source={reelUrl ? 'reel' : 'sheet'} className="flex items-end gap-3">
      <figure className="m-0 flex flex-col gap-1">
        {side('before')}
        <figcaption className="type-meta text-ink-2">{t`Before`}</figcaption>
      </figure>
      <figure className="m-0 flex flex-col gap-1">
        {side('after')}
        <figcaption className="type-meta text-ink-2">{t`After`}</figcaption>
      </figure>
    </div>
  );
}
