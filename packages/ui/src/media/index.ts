// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Phase 3 (ui-make): this area's public surface, re-exported by the package's index.ts. */
export type {
  CardVoiceCapture,
  CardVoiceRecording,
  MediaCardActions,
  MediaCardData,
  MicrophonePermission,
  PreviewPlayFrom,
} from './media-actions';
export { GRAPHIC_FIXTURE_DESIGNS, MEDIA_FIXTURE_IDS } from '../cards/fixtures-media';
export {
  DESIGN_CHANGES_FIXTURES,
  DESIGN_COMPOSITIONS,
  DESIGN_FIXTURE_IDS,
  DESIGN_GRAPHIC_FIXTURES,
  designRevisions,
} from '../cards/fixtures-designs';
export { DESIGN_FILE_SHAS, DESIGN_FILE_TEXT } from '../cards/fixtures-design-files';
// EDT1-GFX: a graphic's editing pieces, for the editor's graphics inspector.
export { GraphicProposalRow, type GraphicProposalRowProps, type ProposalTryAgain } from './graphic-proposal';
export { GraphicTiming, type GraphicTimingProps } from './graphic-timing';
export { MediaError } from './media-lines';
export { USE_PROPOSAL, EDIT_GRAPHIC, REMOVE_GRAPHIC } from './media-commands';
// HFW1-UI: a designed graphic's pieces, for the editor's inspector.
export { DesignProposalRow, type DesignProposalRowProps } from './design-proposal';
export { DesignVariablesForm, variableKey, type DesignVariablesProps } from './design-variables';
export { designOf, designValues, variableWords, type DesignValue } from './design-reads';
