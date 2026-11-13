// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Reading an overlay's design from its pixels (BRK1-GFX); breakdown/overlay-design.ts runs it in the breakdown. */
export { readDesign, readDesignAndLead, type DesignInput } from './read';
export { AROUND_ENTRANCE, AROUND_EXIT, edgeFramesFor } from './motion';
export { composeSheet, encodePng, SHEET, type SheetInput } from './sheet';
export { crop, grow, type PixelRect, type RegionImage, type RgbFrame } from './pixels';
