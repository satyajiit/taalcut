// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the reel as a filmstrip (BRK1-REV, the breakdown card) · system: DESIGN.md v0.7
 *   (footage at its own shape on the viewer grey; rose marks the cuts)
 * the reel's own frames side by side at the reel's shape, portrait or landscape, as many as fit the width, each the
 *   frame of the slot at its moment: the strip is the reel's time axis. Over it, a rose tick above each cut, and a
 *   dashed warning circle above a cut Taalcut isn't sure of; through it, a hairline of the page at each cut. A
 *   picture, not a control: the card's words say what it shows
 * states: loading (the grey until the sheet's image arrives) · no sheet (the grey alone) · narrow (fewer frames)
 */
import type { Id, Template } from '@taalcut/core';
import { useEffect, useRef, useState } from 'react';
import { sheetTileStyle } from './sheet-tile';
import { toSeconds } from './slot-words';

export interface ReelFilmstripProps {
  template: Template;
  sheetUrl: string | null;
  /** Slots whose cut Taalcut isn't sure of. */
  unsure: ReadonlySet<Id<'TemplateSlot'>>;
  /** The frames' height for a portrait reel, px; a landscape one is lower. */
  height?: number;
}

export function ReelFilmstrip({ template, sheetUrl, unsure, height = 64 }: ReelFilmstripProps) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const total = toSeconds(template.duration) || 1;
  const ratio = template.canvas.width / template.canvas.height;
  const tall = ratio >= 1 ? Math.round(height * 0.75) : height;
  const count = width > 0 ? Math.max(1, Math.floor(width / (tall * ratio))) : 0;
  const tileWidth = count > 0 ? width / count : 0;
  const tileHeight = tileWidth / ratio;
  const sheet = template.contactSheet;
  const frameAt = (seconds: number) => {
    let at = 0;
    for (let i = 0; i < template.slots.length; i += 1)
      if (toSeconds(template.slots[i]!.start) <= seconds) at = i;
    const slot = template.slots[at]!;
    return slot.frame ?? sheet?.frames.findIndex((frame) => frame.slotId === slot.id) ?? -1;
  };
  return (
    <div aria-hidden data-slot="reel-filmstrip" className="flex flex-col gap-1">
      <div className="relative h-2.5">
        {template.slots.slice(1).map((slot) => (
          <span
            key={slot.id}
            data-unsure={unsure.has(slot.id) || undefined}
            className={
              unsure.has(slot.id)
                ? 'absolute top-0 size-2.5 -translate-x-1/2 rounded-pill border-2 border-dashed border-warning-strong'
                : 'absolute top-1 h-1.5 w-0.5 -translate-x-1/2 rounded-pill bg-beat-strong'
            }
            style={{ left: `${(toSeconds(slot.start) / total) * 100}%` }}
          />
        ))}
      </div>
      <div
        ref={box}
        className="relative flex overflow-hidden rounded-md bg-viewer"
        style={{ height: tileHeight || tall }}
      >
        {Array.from({ length: count }, (_, i) => {
          const tile = frameAt(((i + 0.5) / count) * total);
          return (
            <span
              key={i}
              className="block shrink-0 bg-no-repeat"
              style={
                sheet && tile >= 0
                  ? sheetTileStyle(sheet, sheetUrl, tileWidth, tileHeight, tile)
                  : { width: tileWidth, height: tileHeight }
              }
            />
          );
        })}
        {template.slots.slice(1).map((slot) => (
          <span
            key={slot.id}
            className="absolute top-0 bottom-0 w-0.5 -translate-x-1/2 bg-canvas"
            style={{ left: `${(toSeconds(slot.start) / total) * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}
