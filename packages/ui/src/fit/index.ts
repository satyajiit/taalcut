// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** LRN1-TPL: templates that fit the footage; this area's public surface, re-exported by the package's index.ts. */
export { FitFacts, FitMissing, FitRow, type FitRowProps } from './fit-row';
export { FitOrderSelect, SavedByFit, useFitOrder, type FitOrder, type SavedByFitProps } from './fit-order';
export {
  fitRevision,
  FITS_ON_IMPORT,
  TemplatesThatFit,
  type TemplatesThatFitProps,
} from './templates-that-fit';
export { useTemplateFit, type TemplateFitState } from './use-template-fit';
