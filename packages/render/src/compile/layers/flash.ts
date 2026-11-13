// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The white overlay of flash and dip-to-white transitions (its animation rides with the visuals layer's). */
import { ok } from '@taalcut/core';
import { windowSeconds } from '../../time/frames';
import { elementId } from '../animations';
import { element } from '../html';
import { layerOutput, type CompositionLayer } from '../layer';

export const flashLayer: CompositionLayer = {
  id: 'flash',
  build({ plan, rate }) {
    const flashes = plan.transitions.filter((t) => t.effect === 'flash' || t.effect === 'dipToWhite');
    const markup = flashes.map((transition) => {
      const window = windowSeconds(transition.span.start, transition.span.end, rate);
      return element('div', {
        id: elementId.flash(transition.id),
        class: 'clip tc-flash',
        'data-start': window.start,
        'data-duration': window.duration,
      });
    });
    const css = flashes.map((transition) => `#${elementId.flash(transition.id)} { opacity: 0; }`);
    return ok(layerOutput({ markup, css }));
  },
};
