// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: clip frames · mode: Operate · system: WEB2 Remix Vernacular · DESIGN.md v0.7.2 (Shapes › Frames: footage at its own 9:16 shape;
 *   something with nothing to show is a dashed rule-strong frame on sunken with the clip glyph, never a dark tile)
 * a clip's picture from the camera roll's sprite atlas (the owner's footage); a filmstrip of them across a timeline
 *   block (apps/renderer/src/features/timeline/clip-block.tsx); a reel's poster; and the empty frame for a sample
 *   clip that has no real footage
 * states: footage (the atlas cell; the viewer grey shows while it loads) · empty (dashed, the clip glyph) · not
 *   interactive (the control around a frame carries the states) */

import type { CSSProperties } from 'react';
import { cn } from '#lib/cn';
import { ICON_STROKE, ICONS } from '#lib/icons';
import { spriteStyle } from './frames';

/** The empty frame's face, without its shape: a frame or a timeline block gives the shape. */
const EMPTY = 'flex items-center justify-center border-[1.5px] border-dashed border-rule-strong bg-sunken text-ink-3';

/** The dashed frame of a clip with nothing to show: a sample with no real footage. */
export function EmptyFrame({ className }: { readonly className?: string }) {
  const Clip = ICONS.clip;
  return (
    <span
      aria-hidden
      data-frame="empty"
      className={cn('aspect-[9/16] rounded-md', EMPTY, className)}
    >
      <Clip strokeWidth={ICON_STROKE} className="size-4 max-w-[60%] shrink-0" />
    </span>
  );
}

/** A clip's picture at 9:16, cut from the atlas; the empty frame when the clip has no footage (`sprite` undefined). */
export function ClipFrame({ sprite, className }: { readonly sprite: number | undefined; readonly className?: string }) {
  if (sprite === undefined) return <EmptyFrame className={className} />;
  return <span aria-hidden data-frame="footage" className={cn('block aspect-[9/16] overflow-hidden rounded-md bg-viewer', className)} style={spriteStyle(sprite)} />;
}

/** A reel's poster at 9:16 (#content/reels `poster`); the empty frame when there is none. */
export function PosterFrame({ src, className }: { readonly src: string; readonly className?: string }) {
  if (!src) return <EmptyFrame className={className} />;
  const style: CSSProperties = { backgroundImage: `url(${src})` };
  return <span aria-hidden data-frame="footage" className={cn('block aspect-[9/16] overflow-hidden rounded-md bg-viewer bg-cover bg-center', className)} style={style} />;
}

/**
 * A clip's frames side by side across a block, the way the app's timeline draws a shot: `count` 9:16 frames at the
 * block's height, taking the clip's frames in turn; the block clips what doesn't fit. No frames: the empty frame's
 * dashes across the block.
 */
export function Filmstrip({ sprites, count, className }: { readonly sprites: readonly number[]; readonly count: number; readonly className?: string }) {
  if (sprites.length === 0) return <span aria-hidden data-frame="empty" className={cn(EMPTY, className)} />;
  return (
    <span aria-hidden className={cn('flex min-h-0 overflow-hidden bg-viewer', className)}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} data-frame="footage" className="aspect-[9/16] h-full shrink-0" style={spriteStyle(sprites[i % sprites.length] ?? 0)} />
      ))}
    </span>
  );
}
