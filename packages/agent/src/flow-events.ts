// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Phase 2 log types (SPEC section 17): skills, flows, estimates and the cards
 * the agent computes. Kept apart from events.ts so each file stays small; the
 * envelope, versions and upcasters are events.ts's.
 */
import type { Billed, Card, ChatStart, EntityRef, ModelModuleId, OpeningPath } from '@taalcut/core';

/** One module's share of an estimate: the model that would run and what it would cost. */
export interface EstimateLine {
  module: ModelModuleId;
  provider: string;
  model: string;
  local: boolean;
  tokens: number;
  usd: number;
  /** What the provider bills when it isn't tokens (a paid tool's images, characters, seconds; review M8). */
  billed?: Billed;
}

/** A model the user could switch to for the same work, priced (the budgetCap card's "cheaper model"). */
export interface CheaperChoice {
  module: ModelModuleId;
  provider: string;
  model: string;
  local: boolean;
  usd: number;
}

/** Where a step sits in its flow: which way in it serves and, after casting, which variant. */
export interface FlowStepInfo {
  /** The flow table's key for the step: 'analyst', 'librarian', 'editor', 'reviewer', 'export', 'brief'. */
  key: string;
  /** 1-based; 1 until the Librarian hands off more than one variant. */
  variant: number;
  /** QA fixes the Editor applies (the fix loop). */
  fixes?: unknown[];
  /** Set on a step that runs again because the user changed something before it. */
  rerun?: boolean;
  /**
   * AGT2: on a review and export queued after an export was refused because the timeline moved (core.conflict),
   * the timeline's revision as the store had it then; a newer handoff of the variant still wins.
   */
  revision?: number;
}

export interface FlowEventPayloads {
  'skill.entered': { stepId: string; skill: string; version: string; input: unknown };
  'skill.verified': { stepId: string; verdict: 'pass' | 'retry' | 'fail'; reason?: string };
  'skill.handedOff': {
    stepId: string;
    skill: string;
    version: string;
    /** The handoff inline, or (over 8 KiB) the artifact it was stored as. */
    output?: unknown;
    artifact?: { id: string; bytes: number };
    outputHash: string;
    refs: EntityRef[];
    /** BRK1-MAKE: Taalcut settled the step from what is stored, after the model's handoff failed its last check. */
    settled?: true;
  };
  'flow.started': {
    flowId: string;
    path: OpeningPath;
    start: ChatStart;
    projectId?: string;
    /** The flow whose card ids this run's cards reuse: an earlier run's flow in the same conversation and project. */
    cardFlowId: string;
    /** The brief or other facts the model gave startFlow. */
    input?: Record<string, unknown>;
  };
  /** The user changed something a finished step made; later steps run again once. */
  'flow.inputChanged': { stepIds: string[]; refs: EntityRef[]; commandId: string };
  /** A flow step that won't run (an export after QA failed its last round, a declined export). */
  'step.skipped': { stepId: string; reason: 'qa-failed' | 'declined' | 'superseded' };
  'estimate.recorded': {
    estimateId: string;
    stepId?: string;
    toolCallId?: string;
    /** i18n key of what the money is for (the skill's label, or the tool's). */
    labelKey: string;
    skill?: string;
    tool?: string;
    estimate: { usd: number; tokens: number };
    lines: EstimateLine[];
    /** The project's cap and what it had spent when the estimate was made; absent without a cap. */
    cap?: { usd: number; spentUsd: number };
  };
  'estimate.settled': { estimateId: string; actual: { usd: number; tokens: number } };
  /** A card the agent computed (a skill's step card, a tool's approval or result card, the opening choices). */
  'card.sent': { card: Card; stepId?: string; toolCallId?: string; approvalId?: string };
  /** No step for 24 hours: the flow's cost was reported as abandoned. */
  'flow.abandoned': { flowId: string };
}

export const FLOW_EVENT_VERSIONS: Readonly<Record<keyof FlowEventPayloads, number>> = {
  'skill.entered': 1,
  'skill.verified': 1,
  'skill.handedOff': 1,
  'flow.started': 1,
  'flow.inputChanged': 1,
  'step.skipped': 1,
  'estimate.recorded': 1,
  'estimate.settled': 1,
  'card.sent': 1,
  'flow.abandoned': 1,
};
