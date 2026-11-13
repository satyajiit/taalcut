// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The router classifier's request and answer shapes (models SPEC P3.5): Taalcut's own, never pi-ai's. */
import type { AsyncResult, CloudCallId, ProjectId } from '@taalcut/core';
import type { ModelChoice } from '../modules';

export type ClassifierQuestion =
  /** Pick one option; `options` maps option id → what it means. */
  | {
      readonly type: 'choice';
      readonly instructions: string;
      readonly options: Readonly<Record<string, string>>;
    }
  | { readonly type: 'bool'; readonly instructions: string; readonly yes: string; readonly no: string }
  | { readonly type: 'score'; readonly instructions: string; readonly criteria: readonly string[] };

export type ClassifierAnswer =
  | {
      readonly type: 'choice';
      readonly choice: string;
      readonly probabilities: Readonly<Record<string, number>>;
      readonly confidence: number;
    }
  | { readonly type: 'bool'; readonly probability: number }
  | { readonly type: 'score'; readonly score: number; readonly confidence: number };

export interface ClassifyRequest {
  /** What the classifier judges: plain JSON (the user's message, recent tool names...). */
  readonly state: Readonly<Record<string, unknown>>;
  readonly questions: Readonly<Record<string, ClassifierQuestion>>;
  /**
   * Extra text per question and option for on-device classifiers only (the rules router's BM25 reads each
   * family's tool one-liners here). Never sent to a provider, so it costs no tokens.
   */
  readonly localHints?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Overrides the chain with one model. */
  readonly target?: ModelChoice;
  readonly signal?: AbortSignal;
  readonly trace?: { readonly runId?: string; readonly spanId?: string; readonly projectId?: ProjectId };
}

export interface ClassifyResult {
  readonly callId: CloudCallId;
  readonly provider: string;
  /** The model that answered: the provider's resolved id when it names one (TypeSafe's `model` field). */
  readonly model: string;
  readonly answers: Readonly<Record<string, ClassifierAnswer>>;
  readonly inputTokens: number;
  readonly costUsd: number;
  readonly latencyMs: number;
  /** Answered on this Mac (the rules router): nothing left the device. */
  readonly local: boolean;
}

export interface Classifier {
  classify(request: ClassifyRequest): AsyncResult<ClassifyResult>;
}
