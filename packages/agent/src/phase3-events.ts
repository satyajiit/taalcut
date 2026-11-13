// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Phase 3's log types (SPEC section 29): the router's decisions beside the main model's, and flow extensions.
 * Kept apart from events.ts like flow-events.ts; the envelope, versions and upcasters are events.ts's.
 */
import { CONTEXT_EVENT_VERSIONS, type ContextEventPayloads } from './context/context-events';
import { LIMIT_EVENT_VERSIONS, type LimitEventPayloads } from './limits/limit-events';

/** What the router answered for one turn, as the shadow log keeps it. */
export interface RouterAnswerLog {
  /** A tool family id or 'none'. */
  choice: string;
  /** The three likeliest options with their probabilities, best first. */
  top3: { option: string; probability: number }[];
  confidence: number;
  /** provider/model as the router's answer named it (the resolved id). */
  model: string;
  latencyMs: number;
  costUsd: number;
}

export interface Phase3EventPayloads extends LimitEventPayloads, ContextEventPayloads {
  /** The router answered beside the main model's call; it never changed it. */
  'route.shadow': { stepId?: string; modelCallId: string; router: RouterAnswerLog };
  /** The model left a routed family (findTools outside it, or a domain tool where the router said none). */
  'route.override': { stepId?: string; modelCallId: string; routed: string; called: string };
  /** The router didn't answer in time (or failed): a disagreement in the report, never a delay. */
  'route.timeout': {
    stepId?: string;
    modelCallId: string;
    afterMs: number;
    /** The error code when it failed rather than timed out. */
    errorCode?: string;
  };
  /**
   * A flow extension was asked whether its step joins after (or before) this anchor step: once per extension
   * and anchor, so a resumed run never asks again and a replay reads the answer instead of asking.
   */
  'flow.extensionChecked': {
    extension: string;
    anchorStepId: string;
    joined: boolean;
    /** Set when the extension couldn't decide (a store it reads failed): its step didn't join. */
    errorCode?: string;
  };
  /**
   * An optional flow step joined the plan (gaps after the Librarian, the voice steps). `data`: the facts the
   * extension decided on (the gaps it found and the fixes it proposed), so the step's input and cards are
   * rebuilt from the log.
   */
  'flow.extended': {
    extension: string;
    stepId: string;
    data?: unknown;
    /** FIX-ASK: another round of facts for a step that joined already (FlowExtension.again); the latest counts. */
    again?: true;
  };
}

export const PHASE3_EVENT_VERSIONS: Readonly<Record<keyof Phase3EventPayloads, number>> = {
  ...LIMIT_EVENT_VERSIONS,
  ...CONTEXT_EVENT_VERSIONS,
  'route.shadow': 1,
  'route.override': 1,
  'route.timeout': 1,
  'flow.extensionChecked': 1,
  'flow.extended': 1,
};
