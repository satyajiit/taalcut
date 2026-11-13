// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** HFW1 (render's index): the Designer, its workspace tools and the composition commands they dispatch. */
export {
  DESIGNER_EXTRA_TOOLS,
  DESIGNER_LABEL,
  DESIGNER_SKILL_ID,
  DESIGNER_TOOLS,
  designerSkill,
  type DesignerSkillDeps,
} from './skills/designer';
export {
  checkDesigns,
  DESIGNER_JOBS_MAX,
  designerInputSchema,
  designerJobSchema,
  designerOutputSchema,
  type DesignerInput,
  type DesignerJob,
  type DesignerOutput,
} from './skills/designer-checks';
export { DESIGNER_PROMPT, DESIGNER_PROMPT_VERSION } from './skills/designer-prompt';
export { WORKSPACE_EXTRA_TOOLS, WORKSPACE_TOOLS, workspaceToolModule } from './workspace/tools/module';
export type { DesignerOf, TemplateGraphicsSource, WorkspaceToolDeps } from './workspace/tools/deps';
export { briefText, BUNDLED_FAMILIES, GSAP_PLUGINS } from './workspace/tools/brief';
export { RENDERS_PER_RUN } from './workspace/tools/check-tools';
export { scaffoldHtml } from './workspace/tools/scaffold';
export { DOCS_TOPICS } from './workspace/tools/docs-tool';
export { COMPOSITION_STYLE_KEY, FULL_FRAME, withComposition } from './compositions/composition-commands';
export { DESIGNER_DOCTRINE } from './skills/designer-prompt';
export {
  DESIGNER_LOOP_TURNS,
  designerCallName,
  designerToolDefinitions,
  runDesignerLoop,
  type DesignerCall,
  type DesignerCallRecord,
  type DesignerLoopInput,
  type DesignerLoopResult,
  type DesignerMessage,
  type DesignerModel,
  type DesignerModelAnswer,
  type DesignerPart,
  type DesignerToolDefinition,
} from './workspace/designer/loop';
export {
  TEMPLATE_DESIGNER_PROMPT,
  templateDesigner,
  type TemplateDesignerDeps,
} from './workspace/designer/template-designer';
export { expectedPlace, REEL_MATCH, reelMatch, type ExpectedPlace } from './workspace/designer/reel-match';
export { gateComposition, type GateFile, type WorkspaceGateResult } from './workspace/gate/workspace-gate';
export {
  buildThreeCanvasHtml,
  createSeededRng,
  TC_THREE_RUNTIME_JS,
  threeCameraSpecSchema,
  threeKeyframeSpecSchema,
  threeLightSpecSchema,
  threeMeshSpecSchema,
  threeSceneSpecSchema,
  validateThreeSceneSpec,
  type ThreeCameraSpec,
  type ThreeKeyframeSpec,
  type ThreeLightSpec,
  type ThreeMeshSpec,
  type ThreeSceneSpec,
} from './motion/three-bridge';
export {
  attachPageDiagnostics,
  RUNTIME_ERRORS_PROBE,
  runtimeErrorsCheck,
  type PageDiagnostics,
  type RuntimeErrorRecord,
} from './workspace/frames/cdp-telemetry';
export {
  IMPECCABLE_CRAFT_THRESHOLDS,
  impeccableFrameCheck,
} from './workspace/frames/impeccable-check';
export { TAALCUT_DOCS, TAALCUT_DOCS_TOPICS, type TaalcutDocsTopic } from './workspace/tools/taalcut-docs';
export {
  buildToneAudioScriptHtml,
  renderToneScenePcm,
  TC_TONE_RUNTIME_JS,
  TONE_INSTRUMENTS,
  toneCueSpecSchema,
  toneSceneSpecSchema,
  validateToneSceneSpec,
  type ToneCueSpec,
  type ToneInstrument,
  type ToneSceneSpec,
} from './motion/tone-bridge';
