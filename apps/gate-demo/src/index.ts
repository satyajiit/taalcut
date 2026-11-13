// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * @taalcut/gate-demo: the gate demo's script, the make flow's journeys and
 * their recorded model sessions, for the headless demo in test/, the
 * desktop smoke test (P1-I1), the desktop journeys (P2-M13) and the docked
 * chat's change (EDT1-CTX); and the
 * agent's tool catalogue they were recorded with (catalogue.ts), with what
 * their skill steps were offered (skill-steps.ts).
 */
export {
  CANONICAL_HOME,
  canonicalClient,
  createCanonicaliser,
  scopedCanonicaliser,
  type Canonicaliser,
  type CanonicaliserFor,
} from './canonical';
export {
  catalogueDrift,
  catalogueOf,
  recordCatalogues,
  recordedCatalogue,
  writeRecordedCatalogue,
} from './catalogue';
export { OFFER_META_TOOLS, recordedSkillSteps, skillStepOffer, type RecordedSkillStep } from './skill-steps';
export {
  createRecordedGateModels,
  createRecordedModels,
  EDIT_CHAT_CASSETTE,
  EDIT_CHAT_SESSION,
  EDIT_DESIGN_CASSETTE,
  EDIT_DESIGN_SESSION,
  GATE_DEMO_CASSETTE,
  GATE_DEMO_FIXTURES,
  GATE_DEMO_SESSION,
  isRecording,
  MAKE_FLOW_CASSETTE,
  MAKE_FLOW_SESSION,
  type RecordedGateModels,
  type RecordedGateModelsOptions,
  type RecordedModels,
  type RecordedModelsOptions,
  type RecordedSession,
} from './recorded-models';
export {
  CLOUD_VISION,
  FRAME_DESCRIPTION,
  GATE_AGENT,
  GATE_DEMO_ANSWER,
  GATE_DEMO_ASK,
  GATE_DEMO_ASKS,
  GATE_DEMO_FOLLOW_UPS,
  GATE_DEMO_TITLE,
  gateDemoTurn,
  type DemoTurn,
  type FollowUp,
} from './script';
export * from './make-flow-fixtures';
export { isMakeFlowAsk, makeFlowTitle, makeFlowTurn, makeFlowVisionDescription } from './make-flow-script';
export { EDIT_JOURNEY_ASK, EDIT_JOURNEY_REPORT } from './make-flow-edit';
export { COMMENTED_TEXT, MAKE_FLOW_COMMENTS_ASK } from './make-flow-comments';
export { runMessageText, runStart, runTurn, viewOf, type RequestView } from './anthropic-view';
export { createStandInProvider } from './stand-in';
export {
  EDIT_CHAT_ANSWER,
  EDIT_CHAT_ASK,
  EDIT_CHAT_ASKS,
  EDIT_CHAT_BEAT_FRAMES,
  editChatTurn,
  isEditChatAsk,
} from './edit-chat-script';
export {
  EDIT_DESIGN_ASK,
  EDIT_DESIGN_ASKS,
  EDIT_DESIGN_AT,
  EDIT_DESIGN_NAME,
  EDIT_DESIGN_PROPOSED,
  editDesignTurn,
  isEditDesignAsk,
} from './edit-design-script';
export { EDIT_DESIGN_ENTRY, EDIT_DESIGN_FOLDER } from './edit-design-headline';
