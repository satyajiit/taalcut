// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Preview only: the mixed sound, played by one <audio> (exports mux the mix after capture). */
import { ok } from '@taalcut/core';
import { durationSeconds } from '../../time/frames';
import { element } from '../html';
import { layerOutput, type CompositionLayer, type LayerLink } from '../layer';

export function previewAudioLayer(audio: LayerLink | undefined): CompositionLayer {
  return {
    id: 'previewAudio',
    build({ variant, plan, rate }) {
      if (variant !== 'preview' || !audio) return ok(layerOutput({}));
      return ok(
        layerOutput({
          markup: [
            element('audio', {
              id: 'tc-mix',
              src: 'audio/mix.m4a',
              preload: 'auto',
              'data-start': '0',
              'data-duration': durationSeconds(plan.durationFrames, rate),
              'data-volume': '1',
            }),
          ],
          links: { 'audio/mix.m4a': audio },
        }),
      );
    },
  };
}
