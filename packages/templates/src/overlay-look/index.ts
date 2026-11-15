// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Reading an overlay's design from its pixels (BRK1-GFX); breakdown/overlay-design.ts runs it in the breakdown. */
export { readDesign, readDesignAndLead, type DesignInput } from './read';
export { AROUND_ENTRANCE, AROUND_EXIT, edgeFramesFor } from './motion';
export { composeSheet, encodePng, SHEET, type SheetInput } from './sheet';
export { crop, grow, settle, type PixelRect, type RegionImage, type RgbFrame, type Rgb } from './pixels';
// TXT1: how an overlay's letters are set, measured from its settled frames.
export {
  readType,
  STEM_WEIGHTS,
  TYPE_LOOK,
  typeOf,
  weightOfStem,
  type TypeInput,
  type TypeRead,
} from './type-look';
export { TYPE_EDGES } from './type-edges';
export { TYPE_INK } from './type-ink';
export { TYPE_MEASURE } from './type-measure';
