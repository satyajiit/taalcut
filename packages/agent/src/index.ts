// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * @taalcut/agent: the agent loop, event log, resume and replay, budgets,
 * autonomy, tracing and prompt assembly. See SPEC.md.
 *
 * This file is the package's only public entry point. Other packages import
 * from '@taalcut/agent' and never from a path inside src/.
 */
export { createAgent } from './agent';
export * from './creation';
export * from './products';
export {
  DEFAULT_BUDGET,
  type Agent,
  type AgentDeps,
  type AgentFeedEvent,
  type AgentSettings,
  type ApprovalAnswer,
  type ReplayReport,
  type RunOutcome,
  type StartRequest,
} from './agent-types';
export { budgetBreach, createDefaultCostEstimator, type BudgetBreach } from './budget';
export type * from './cards';
export { createChatService, type ChatServiceDeps } from './chat-service';
export {
  createConversationTitler,
  cleanTitle,
  isManagedTitle,
  PROVISIONAL_TITLE_LENGTH,
  provisionalTitle,
  tidyTitle,
  TITLE_WORDS,
  type ConversationTitler,
  type Exchange,
} from './chat-titles';
export { REASONING_LIMIT } from './chat-translate';
export type * from './chat-types';
export { createCommandDispatcher } from './command-adapter';
// HFW1-DSN: eval:design's Designer loop nudges and ends as a skill step does.
export { LAST_TURN_NOTE, MAX_TEXT_TURNS, textTurnNote } from './turn-context';
export {
  consentKey,
  consentsService,
  createMemoryConsentStore,
  createSettingsConsentStore,
  isUpload,
  UPLOAD_CONSENTS_SETTING,
} from './consent';
export { createMemoryConversationStore } from './conversations';
export { fromCoreEventLog } from './core-event-log';
export { restoreEditorOwnership } from './editor/editor-ownership';
export { DEFAULT_LOOP_SETTINGS, type LoopSettings } from './context';
// EDT1-GFX: the executor's id mending, so tools/evals answers a model's calls as a run does.
export { mendIds, notFoundHint, type MendedIds } from './context/id-repair';
export * from './errors';
export {
  AUTONOMY_LEVELS,
  EVENT_VERSIONS,
  newEvent,
  readEvent,
  TERMINAL_EVENTS,
  UPCASTERS,
  type AgentEvent,
  type AgentEventType,
  type ApprovalKind,
  type AutonomyLevel,
  type BudgetLimit,
  type EventOf,
  type EventPayloads,
  type HistoryTurn,
  type NewAgentEvent,
  type PlanStep,
  type RunHistory,
  type RunBudget,
  type Upcasters,
  type UploadScope,
} from './events';
export { createFileEventLogStore, createMemoryEventLogStore } from './log-stores';
export { buildMessages } from './messages';
export { DEFAULT_HISTORY_TOKENS, fitHistory, historyMessages, historyTurn } from './history';
export { FIND_TOOL, META_TOOLS, PLAN_TOOL, READ_ARTIFACT_TOOL } from './meta-tools';
export { needsApproval } from './policy';
export type * from './ports';
export {
  CONTROL_PREFIX,
  escapeUntrusted,
  loadSoulFile,
  OPERATING_RULES,
  parseSoul,
  renderOutput,
  systemPrompt,
  wrapUntrusted,
  type Soul,
} from './prompt';
export { applyEvent, foldEvents, type RunState } from './state';
export {
  createScriptedModelClient,
  runMessage,
  runMessageIndex,
  scriptedResult,
  streamOf,
  type ModelScript,
  type ScriptedClientOptions,
  type ScriptedReply,
} from './testing';
export {
  buildTrace,
  checkTrace,
  createMemoryTraceExporter,
  createTraceBuilder,
  toOtelSpans,
  traceGaps,
  type OtelSpan,
  type Span,
  type SpanKind,
  type Trace,
  type TraceBuilder,
  type TraceGap,
  type TraceGapReason,
} from './trace';
export { createTraceRecorder, spanRecord, type TraceRecorder } from './trace-store';

// Phase 2: commands, routers, privacy, debug bundle.
export {
  budgetRouter,
  createBudgetCommands,
  createBudgetService,
  type BudgetDeps,
  type BudgetService,
} from './budget-commands';
export {
  createComponentCommands,
  createOnboardingCommands,
  createPrivacyCommands,
  onboardingRouter,
  type ComponentCommandDeps,
  type SettingsCommandDeps,
} from './settings-commands';
export {
  createPrivacyService,
  moduleTraffic,
  privacyRouter,
  type OtherNetworkFlow,
  type PrivacyMemory,
  type PrivacyModulePlan,
  type PrivacyService,
  type PrivacyServiceDeps,
  type SentKind,
} from './privacy-service';
export {
  settingsTelemetryState,
  telemetryIngestRouter,
  telemetryRouter,
  type TelemetryRouterDeps,
  type TelemetryState,
} from './telemetry-routers';
export {
  createRedactor,
  redactRunEvent,
  type RedactedText,
  type RedactionCounts,
  type RedactMode,
  type RedactOptions,
  type Redactor,
} from './redact';
export {
  createDebugBundleCollector,
  debugBundleRouter,
  type DebugBundleCollector,
  type DebugBundleDeps,
  type DebugCollectRequest,
} from './debug-bundle';

// Phase 2: skills, flows, costs (SPEC sections 11–14).
export { STOPPED_AT_BUDGET } from './agent-answer';
export {
  COST_TOLERANCE,
  costAccuracy,
  SMALL_COST_TOLERANCE_USD,
  SMALL_COST_USD,
  withinTolerance,
  type CostAccuracyReport,
  type CostPair,
} from './cost-accuracy';
export { DEFAULT_EXPECTED_TURNS } from './costs';
export type * from './flow-events';
export { MAX_FIX_LOOPS, reviewOutcome } from './flow-followups';
export { MAX_EXPORT_RETRIES } from './export-conflicts';
export type { CommandChange } from './flow-watcher';
export {
  agentSkillModule,
  briefSkill,
  EXPORT_TOOL,
  FLOW_SKILLS,
  flowProblems,
  FLOWS,
  type FlowStepDef,
} from './flows';
export { runTurnLimit, stepTurnLimit } from './turn-limits';
export { ASK_USER_TOOL, HAND_OFF_TOOL, START_FLOW_TOOL } from './meta-tools';
export { FLOW_RULES, mainSystemPrompt, QUESTION_RULE, SKILL_RULES, skillSystemPrompt } from './skill-prompt';
export { createSkillRegistry, emptySkillRegistry, SkillModulesToken, type SkillRegistry } from './skills';
export { FLOW_BUDGET, SKILL_INPUT_NOTE } from './state-flow';

// Phase 3 (SPEC sections 21–29). Each feature adds its exports below its own comment.
export type { Phase3Deps } from './phase3-deps';
export type { Phase3EventPayloads, RouterAnswerLog } from './phase3-events';
export type { RouteRecord } from './run-state';

// Soul v1 (P3-B15, SPEC section 22).
export * from './soul';
// Tone evals (what `tools/evals tone` calls).
export * from './evals';

// Reference timestamps (P3-V15, SPEC section 23).
export * from './timestamps';
// The editor's docked chat (EDT1-CTX, SPEC section 38).
export * from './editor';

// Flow extensions and gaps (P3-B8, SPEC sections 25 and 26).
export {
  composeFlowExtensions,
  flowExtensionProblems,
  FlowExtensionsToken,
  type FlowExtension,
  type FlowExtensionCardInput,
  type FlowExtensionContext,
  type FlowExtensionDecision,
  type FlowExtensionDeps,
  type FlowExtensionStep,
  type LoggedExtensionCheck,
  type SettlerCall,
  type StepSettler,
} from './flows/extensions';
export { GAPS_EXTENSION, gapsExtension, type GapsExtensionDeps } from './flows/extensions/gaps';
export {
  asksForVoiceover,
  VOICE_EXTENSION,
  VOICE_SKILL,
  voiceExtension,
  type VoiceExtensionDeps,
} from './flows/extensions/voice';
export {
  VOICE_FINALIZE_EXTENSION,
  VOICE_FINALIZE_TOOL,
  voiceFinalizeExtension,
  type VoiceFinalizeDeps,
} from './flows/extensions/voice-finalize';
export { type AgentGapsOptions } from './flows';
export { gapFixCards, gapsJoinDataSchema, type GapsJoinData } from './gaps/gap-card';
export {
  checkGaps,
  createGapsSkill,
  GAP_REQUIRED_TOOLS,
  GAP_TOOLS,
  GAPS_SKILL_ID,
  gapsInputSchema,
  gapsOutputSchema,
  type GapsOutput,
  type GivenGaps,
} from './gaps/gap-skill';
export { GAP_PROMPT, GAP_PROMPT_VERSION } from './gaps/gap-prompt';
export {
  GAP_SLOT_STATES,
  type AddedClips,
  type BorrowShot,
  type GapCarry,
  type GapClips,
  type GapOffers,
  type GapReadOptions,
  type ReuseShot,
  type GapRow,
  type GapsDeps,
  type GapShot,
  type GapSlot,
  type GapSlotState,
  type GapSource,
  type GapTimeline,
  type ImagePath,
  type StockPath,
  type SwapTarget,
  type WeakPickInfo,
} from './gaps/gap-types';
export { chooseDefaults, gapRow, imagePrompt, proposeFixes, type ProposalInput } from './gaps/proposals';
export { answeredRows, type GapAnswer, type OfferedClips } from './gaps/answers';
export { gapReply } from './gaps/gap-reply';
export { answerInChat, chatGapAnswer, waitingGapQuestion, type ChatGapAnswer } from './chat-pending';
export { askReasons, asksAt, MANY_UNSURE, shotCount } from './gaps/ask-policy';
export { closestOf, shortWants, summaryOf, type GapClosest } from './gaps/gap-facts';
export { BORROW_GAIN, borrowable, reusable, settleTrades, tradeGain, tradeOptions } from './gaps/trades';
export { CLIP_WAIT, latestAnswer, MAX_ROUNDS, waitForClips } from './gaps/gap-rounds';
export { gapTimelineOf } from './gaps/timeline-gaps';

// Limits (G8): pause, wait, switch or stop when a model limit meets a run.
export {
  createRateLimitFollower,
  type RateLimitFollower,
  type RateLimitFollowerDeps,
  type TimerPort,
} from './limits/limit-follower';
export { LIMIT_WAIT_MS } from './limits/limit-answer';
export type { RateLimitDeps } from './limits/limit-port';
export type { LimitEventPayloads, LimitModelRef, RateLimitAsk } from './limits/limit-events';

// Router (P3-B11): shadow mode, the live gate, the switch-on report and agent.setRouter.
export {
  createRouteAdvisor,
  ROUTE_INSTRUCTIONS,
  routeRequest,
  type RouteAdvisorDeps,
} from './router/advisor';
export {
  FAMILY_DESCRIPTIONS,
  FAMILY_PREFIXES,
  familyOfCall,
  mainFamily,
  NONE_FAMILY,
  routeFamilies,
} from './router/families';
export { familyLive, LIVE_FAMILY_CONFIDENCE, LIVE_NONE_CONFIDENCE } from './router/gate';
export { recordedRouteAdvisor } from './router/replay-advisor';
export {
  ROUTER_GATE,
  routerDecisions,
  routerReport,
  wilson,
  type Agreement,
  type Interval,
  type RouterGolden,
  type RouterGoldenRun,
  type RouterReport,
  type RouterReportOptions,
} from './router/report';
export { createRouterCommands, type RouterCommandDeps } from './router/router-commands';
export {
  DEFAULT_ROUTER_TIMINGS,
  type RouteAdvisor,
  type RouteAsk,
  type RouteFamily,
  type RouteOutcome,
  type RouterTimings,
} from './router/router-port';

// External runs (P3-V4): an MCP session's tool calls as one run with no model loop (mcp-release wires it).
export { createExternalRunner, type ExternalRunnerDeps } from './external/runner';
export { levelAllows, withLocalOnlyNow, withRequesterCard } from './external/external-policy';
export type { ExternalRunHost, HeldRun } from './agent-types';
export type {
  ExternalCallOptions,
  ExternalCallOutcome,
  ExternalRunHandle,
  ExternalRunInfo,
  ExternalRunner,
  ExternalRunSession,
  McpRequester,
} from './external/external-types';

// Local only (P3-B10): what a run may still do on this Mac, and the switch as it is now.
export { LOCAL_ONLY_REFUSAL, localOnlyRefusal, type LocalOnlyDeps } from './local-only/local-only';

// HyperFrames motion skills & chat effect routing.
export {
  effectIdsFromSelections,
  effectSelectionLines,
  effectToolsFor,
  hasMotionTools,
  HYPERFRAMES_MOTION_SKILLS,
  isEffectChip,
} from './hyperframes-skills';
export { selectionNote } from './state-flow';

// Agent memory (LRN1-MEM, SPEC section 33).
export * from './memory';
