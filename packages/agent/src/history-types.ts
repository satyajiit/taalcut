// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The conversation so far as run.started logs it (events.ts): its earlier runs' turns, fitted to a budget. */

/** One earlier run of the conversation, as the next run's prompt shows it (history.ts). */
export interface HistoryTurn {
  readonly runId: string;
  /** The user's message, cut at 4,000 characters. */
  readonly user: string;
  /** One entry per tool call: name and outcome, then input and result cut short and fenced as untrusted. */
  readonly tools: readonly string[];
  /** What the model said in that run, cut at 4,000 characters. */
  readonly answer: string;
  readonly status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  /**
   * BRK1-MAKE: what a flow that didn't finish left, in plain words: the step it stopped at and why, what the
   * steps before it made, and whether anything was exported. Absent in older logs and for a finished run.
   */
  readonly outcome?: string;
  /** The model that said it. */
  readonly provider?: string;
  readonly model?: string;
}

/** A conversation's earlier turns in a run's prompt, and the oldest ones left out to fit the budget. */
export interface RunHistory {
  readonly turns: readonly HistoryTurn[];
  readonly trimmed?: { readonly runIds: readonly string[]; readonly tokens: number };
}
