// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MotionTween, MotionVars } from '../../motion/motion-data';
import type { PlannedVisual } from '../../plan/types';
import {
  layoutCropAt,
  layoutSourceTime,
  layoutTransform,
  type LayoutSize,
} from '../../reframe/visual-layout';
import { elementId } from '../animations';
import { element } from '../html';
import type { LayerContext } from '../layer';

/** Trusted video viewports, separate from the Designer's HTML allowlist. Both use the same timed source. */
export function visualRegions(
  visual: PlannedVisual,
  source: LayoutSize,
  context: LayerContext,
  media: (id: string) => string,
) {
  const parent = elementId.visual(visual);
  const markup: string[] = [];
  const css: string[] = [];
  const tweens: MotionTween[] = [];
  const fps = context.rate.num / context.rate.den;
  for (const [index, region] of visual.visualLayout!.regions.entries()) {
    const id = `${parent}-r${index}`;
    const viewportId = `${id}-viewport`;
    const varsAt = (frame: number): MotionVars => {
      const crop = layoutCropAt(region, layoutSourceTime(visual, frame, context.rate));
      const { x, y, scale, clipPath } = layoutTransform(region, crop, source, context);
      return { x, y, scale, clipPath, transformOrigin: '0% 0%' };
    };
    const first = varsAt(visual.visible.start);
    const viewport = region.viewport;
    css.push(
      `#${viewportId} { position: absolute; left: ${viewport.x * context.width}px; top: ${viewport.y * context.height}px; width: ${viewport.width * context.width}px; height: ${viewport.height * context.height}px; overflow: hidden; }`,
      `#${id} { position: absolute; left: 0; top: 0; width: ${source.width}px; height: ${source.height}px; object-fit: fill; transform-origin: 0 0; }`,
    );
    markup.push(
      element('div', { id: viewportId, 'data-tc-layout-region': `${visual.id}:${index}` }, media(id)),
    );
    tweens.push({
      targets: { ids: [id] },
      at: visual.visible.start / fps,
      duration: 0,
      from: first,
      to: first,
    });
    // Sampling the shared source curve per output frame also covers speed ramps and changing crop sizes exactly.
    if (region.keyframes.length > 1 && !visual.holdFrame) {
      let previous = first;
      for (let frame = visual.visible.start + 1; frame <= visual.visible.end; frame++) {
        const next = varsAt(frame);
        if (JSON.stringify(next) !== JSON.stringify(previous))
          tweens.push({
            targets: { ids: [id] },
            at: (frame - 1) / fps,
            duration: 1 / fps,
            from: previous,
            to: next,
          });
        previous = next;
      }
    }
  }
  return {
    markup: element('div', { id: parent, class: 'tc-regions' }, markup.join('\n')),
    css,
    tweens,
  };
}
