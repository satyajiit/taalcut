// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the part's picture (TRIM1) · system: DESIGN.md v0.7 (Footage First: the frame
 *   on the viewer grey at the clip's own shape, nothing drawn over it)
 * a small monitor: one frame of the file, fitted at its own shape inside a viewer-grey box whose size the layout
 *   sets and the file never changes (so nothing beside it jumps when the file's shape arrives). It shows the
 *   part's first frame, the frame an end is being dragged to, or the frame under the pointer on the strip: from
 *   the filmstrip at once, then from the copy to play, which has the exact frame; the shot's own picture stands in
 *   until either is there. Playing, it is the copy to play running the part
 * states: loading (a bone the monitor's size) · still · playing · no frames (the shot's picture, or the grey) ·
 *   the copy to play failed (the filmstrip's frame stays; Play is off, the control says why)
 * motion: the video fades in over the still (--dur-short; 150 ms under reduced motion, base.css)
 */
import { cn } from '@taalcut/ui';
import { useMemo } from 'react';
import { frameTimesMs, nearestFrame, useSpriteLoad } from '../../library/clip/scrubber/sprite';
import type { ShotStrip } from '../shot-frames';
import { coverStyle } from './cover-style';
import type { PartPlayer } from './use-part-player';

export interface PartPictureProps {
  /** What the picture is, for a screen reader ("The first frame the scene plays"). */
  label: string;
  /** The file's filmstrip, once there is one. */
  frames: ShotStrip | undefined;
  /** The shot's own picture, until a frame can be drawn. */
  still: string | null;
  /** The frame to show, in milliseconds from the file's first frame. */
  atMs: number;
  /** The clip's shape, width over height. */
  ratio: number;
  /** What the video loads; undefined without a copy to play. */
  videoSrc: string | undefined;
  player: PartPlayer;
  loading: boolean;
  /** The monitor's size, from the layout. */
  className?: string;
}

export function PartPicture({
  label,
  frames,
  still,
  atMs,
  ratio,
  videoSrc,
  player,
  loading,
  className,
}: PartPictureProps) {
  const shape = Number.isFinite(ratio) && ratio > 0 ? ratio : 9 / 16;
  const load = useSpriteLoad(frames?.src ?? null);
  const times = useMemo(() => (frames ? frameTimesMs(frames.filmstrip) : []), [frames]);
  const index = frames && load === 'ready' && times.length > 0 ? nearestFrame(times, atMs) : null;
  return (
    <div
      data-slot="part-monitor"
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-md [container-type:size]',
        loading ? 'tc-bone bg-hover' : 'bg-viewer',
        className,
      )}
    >
      {loading ? null : (
        <div
          role="img"
          aria-label={label}
          data-slot="part-picture"
          data-playing={player.playing || undefined}
          className="relative overflow-hidden"
          style={{ width: `min(100cqw, calc(100cqh * ${shape}))`, aspectRatio: shape }}
        >
          {still && index === null ? (
            <img
              src={still}
              alt=""
              draggable={false}
              decoding="async"
              className="absolute inset-0 size-full object-cover"
            />
          ) : null}
          {frames && index !== null ? (
            <span
              data-slot="part-frame"
              data-frame={index}
              className="absolute inset-0"
              style={coverStyle(frames.filmstrip, frames.src, index, shape)}
            />
          ) : null}
          {videoSrc && !player.failed ? (
            <video
              ref={player.videoRef}
              src={videoSrc}
              preload="auto"
              playsInline
              tabIndex={-1}
              aria-hidden
              data-slot="part-video"
              className={cn(
                'absolute inset-0 size-full object-cover transition-opacity duration-(--dur-short) ease-(--ease-out)',
                player.ready ? 'opacity-100' : 'opacity-0',
              )}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
