// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The layers of a composition in drawing order. A new kind of thing on screen is one new layer file and one
 * entry here; z-index bands (layer.ts `Z`) keep the stacking whatever the order of the markup.
 */
import { brandLayer } from '../../style/brand-layers';
import type { CueLayout } from '../../types';
import type { CompileOptions } from '../compile-options';
import type { CompositionLayer } from '../layer';
import { captionsLayer } from './captions';
import { compositionsLayer } from './compositions';
import { flashLayer } from './flash';
import { previewAudioLayer } from './preview-audio';
import { textsLayer } from './texts';
import { visualsLayer } from './visuals';
import { authoredProgramsLayer } from '../../authored/layer';

export type { BrandAssetFile } from '../../style/brand-layers';

export function compositionLayers(
  options: CompileOptions,
  captionLayouts: readonly { readonly id: string; readonly layout: CueLayout }[],
): CompositionLayer[] {
  return [
    visualsLayer({
      media: options.media,
      ...(options.framing ? { framing: options.framing } : {}),
      ...(options.cropStyle ? { cropStyle: options.cropStyle } : {}),
    }),
    brandLayer(options.brandAssets),
    flashLayer,
    textsLayer,
    authoredProgramsLayer(options.authoredWorkspace),
    compositionsLayer(options.compositions, options.workspace),
    captionsLayer(captionLayouts),
    previewAudioLayer(options.audio ? { source: options.audio.file, key: options.audio.key } : undefined),
  ];
}
