// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P3-B12, P3-V8: the template hub's kit pieces (U3 ShareTemplateView, U4 HubTemplateRow, U6 StructurePreview). */
export { HubRatingText } from './hub-rating';
export {
  HubTemplateRow,
  type HubForkStatus,
  type HubRowFork,
  type HubRowItem,
  type HubTemplateRowProps,
} from './hub-template-row';
export { indexAge, isNewRating, languageName, NEW_UNDER_RATINGS, ratingLabel, retryIn } from './hub-words';
export { isHandle } from './share-form';
export { ShareTemplateView, type ShareStatus, type ShareTemplateViewProps } from './share-template-view';
export { problemPlace, problemWords, type ShareProblem } from './share-words';
export {
  previewOfStrip,
  previewOfStructure,
  slotAt,
  structureOf,
  type HubStrip,
  type PreviewModel,
  type PreviewSlot,
} from './structure-of';
export { STRIP_PREVIEW_SECONDS, StructurePreview, type StructurePreviewProps } from './structure-preview';
export { structureSummary } from './preview-words';
