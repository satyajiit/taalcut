// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: safe-zone overlay · genre: atmospheric studio app (the viewer) · system: DESIGN.md v0.3
 * where a platform's own buttons and captions sit over the video, drawn on the preview: the app's parts as quiet
 *   viewer-rule blocks, the safe area as a dashed outline; the same in both themes, as the viewer is
 * states: n/a (decorative, aria-hidden; the words beside the preview say what it shows)
 * pre-emit critique: P4 H4 E5 S5 R5 V4 */
import type { ExportPreset } from '@taalcut/core';
import { cn } from '#lib/cn';

type Rect = ExportPreset['safe'];

export interface SafeZoneOverlayProps {
  overlays: ExportPreset['overlays'];
  safe: Rect;
  /** The canvas the rects are in; presets are 1080 × 1920. */
  width?: number;
  height?: number;
  className?: string;
}

const box = (rect: Rect, width: number, height: number) => ({
  left: `${(rect.x / width) * 100}%`,
  top: `${(rect.y / height) * 100}%`,
  width: `${(rect.width / width) * 100}%`,
  height: `${(rect.height / height) * 100}%`,
});

export function SafeZoneOverlay({
  overlays,
  safe,
  width = 1080,
  height = 1920,
  className,
}: SafeZoneOverlayProps) {
  return (
    <div aria-hidden data-slot="safe-zones" className={cn('pointer-events-none absolute inset-0', className)}>
      {overlays.map((overlay, index) => (
        <span
          key={`${overlay.kind}-${index}`}
          data-overlay={overlay.kind}
          className="absolute rounded-sm bg-viewer-rule/70"
          style={box(overlay.rect, width, height)}
        />
      ))}
      <span
        data-safe
        className="absolute rounded-sm border-[1.5px] border-dashed border-viewer-rule"
        style={box(safe, width, height)}
      />
    </div>
  );
}
