// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { defineError } from '@taalcut/core';

export const RunNotFound = defineError<{ runId: string }>('agent.run_not_found');
/** The run already ended (completed, failed or cancelled). */
export const RunFinished = defineError<{ runId: string }>('agent.run_finished');
/** Another writer appended to the run's log; reload and try again. */
export const LogConflict = defineError<{ runId: string; expectedSeq: number }>('agent.log_conflict', {
  retryable: true,
});
export const LogStoreFailed = defineError('agent.log_store_failed', { retryable: true });
/** Replay asked for a different tool call (or model turn) than the log recorded. */
export const ReplayDiverged = defineError<{ index: number }>('agent.replay_diverged');
export const ApprovalUnknown = defineError<{ requestId: string }>('agent.approval_unknown');
/** The model kept calling tools past the turn limit for a step or a run. */
export const TurnLimit = defineError<{ limit: number }>('agent.turn_limit');
/** A step failed its verification check. */
export const VerifyFailed = defineError<{ stepId: string }>('agent.verify_failed');
/** A skill step's model answered in words, turn after turn, and never used the step's tools (BRK1-MAKE). */
export const NoToolCalls = defineError<{ turns: number }>('agent.no_tool_calls');
/**
 * AGT2: the export was refused again and again because the timeline kept moving past the revision the Reviewer
 * checked (core.conflict), so the flow stopped asking (flow-followups.ts, MAX_EXPORT_RETRIES).
 */
export const ExportKeptChanging = defineError<{ tries: number }>('agent.export_kept_changing');
/** A run was waiting on the model when the process stopped. */
export const ModelCallAbandoned = defineError('agent.model_call_abandoned', { retryable: true });

/* ---------- Phase 2: skills and flows (SPEC section 17) ---------- */

/** A skill module failed its checks at composition; `detail` lists every problem. */
export const SkillInvalid = defineError<{ module: string }>('agent.skill_invalid');
/** A skill step's input, built from the flow or given by the model, doesn't fit the skill's input schema. */
export const SkillInputInvalid = defineError<{ skill: string; stepId: string }>('agent.skill_input_invalid');
/** A skill step called a tool outside the skill's subset; the call never ran. */
export const OutsideSkill = defineError<{ skill: string; tool: string }>('agent.outside_skill');
/** The model tried to drop or reorder a flow's skill steps; sent back to the model. */
export const FlowViolation = defineError('agent.flow_violation');
/** A plan step names a skill no module registered. */
export const SkillNotFound = defineError<{ skill: string }>('agent.skill_not_found');

/* ---------- Phase 3: soul v1 (SPEC section 22) ---------- */

/**
 * SOUL.md has no version, or its dial table doesn't match its front matter: the app refuses to start the
 * agent rather than run without a persona. `detail` says what is wrong.
 */
export const SoulInvalid = defineError<{ reason: 'frontMatter' | 'dialTable' }>('agent.soul_invalid');
/** A tone-eval recording breaks a rule (a judge that wrote a reply it judges, a prompt it doesn't cover). */
export const ToneRecordingInvalid = defineError<{ rule: string }>('agent.tone_recording_invalid');

/* ---------- Phase 3: flow extensions (SPEC section 25) ---------- */

/** A flow extension names a skill or tool that isn't registered, or a bad anchor; `detail` lists every problem. */
export const FlowExtensionInvalid = defineError<{ extension: string }>('agent.flow_extension_invalid');

/* ---------- Phase 3 ---------- */

/** P3-V4: the external agent's session level doesn't cover this tool (read: reads only; edit: no exports). */
export const ExternalLevelTooLow = defineError<{ tool: string; level: string }>(
  'agent.external_level_too_low',
);
