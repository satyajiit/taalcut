// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export { FontMatchWithheld, FontRenderFailed } from './errors';
export { scriptOf, type FontScript } from './script';
export {
  fontCatalogue,
  fontFile,
  loadCatalogue,
  packageFontsDir,
  reservedNameOf,
  type CatalogueEntry,
  type FontFace,
} from './catalogue';
export { type TextRenderRequest, type TextRenderResult, type TextRenderer } from './text-renderer';
export { alignCrop, polarityOf, type GrayImage, type InkBox, type RenderedSample } from './align';
export { meanSsim } from './ssim';
export {
  matchFonts,
  toFontMatch,
  type FontMatchCrop,
  type FontMatchDeps,
  type FontMatchInput,
  type FontRankingRow,
  type FontSuggestionList,
} from './font-match';
