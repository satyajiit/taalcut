// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

/**
 * The words for the errors a chat's run, its steps and the app's own parts can end with (@taalcut/agent,
 * @taalcut/tools and its MCP gateway and sandbox, core's command bus, @taalcut/jobs and @taalcut/desktop): what
 * happened, then what to do. FIX-ERRWORDS: these showed "Something went wrong" (apps/desktop's error-words test
 * checks every code has words). Parameters are the error's own; none of them is ever a path.
 */
export const AGENT_ERROR_WORDS: Readonly<Record<string, MessageDescriptor>> = {
  // @taalcut/agent
  'errors.agent.turn_limit': msg({
    id: 'errors.agent.turn_limit',
    message:
      'Taalcut stopped after {limit, plural, one {# step} other {# steps}} without finishing. Ask it to carry on.',
  }),
  'errors.agent.verify_failed': msg({
    id: 'errors.agent.verify_failed',
    message: 'A step didn’t pass its check. Ask Taalcut to try it again.',
  }),
  'errors.agent.no_tool_calls': msg({
    id: 'errors.agent.no_tool_calls',
    message:
      'The model kept answering in words instead of doing this step, so Taalcut stopped it. Nothing was made. Ask Taalcut to try again.',
  }),
  'errors.agent.export_kept_changing': msg({
    id: 'errors.agent.export_kept_changing',
    message:
      'The video kept changing each time Taalcut went to export it, so Taalcut stopped. Nothing was exported. When nothing else is changing it, ask Taalcut to export it again.',
  }),
  'errors.agent.model_call_abandoned': msg({
    id: 'errors.agent.model_call_abandoned',
    message: 'Taalcut stopped while it was waiting for the model. Ask it to carry on.',
  }),
  'errors.agent.run_not_found': msg({
    id: 'errors.agent.run_not_found',
    message: 'Taalcut can’t find that step any more. Ask again in the chat.',
  }),
  'errors.agent.run_finished': msg({
    id: 'errors.agent.run_finished',
    message: 'That step had already finished, so there was nothing left to answer.',
  }),
  'errors.agent.approval_unknown': msg({
    id: 'errors.agent.approval_unknown',
    message: 'That question isn’t open any more. Ask Taalcut again if you still need it.',
  }),
  'errors.agent.log_conflict': msg({
    id: 'errors.agent.log_conflict',
    message: 'This chat changed somewhere else at the same moment. Reload it and try again.',
  }),
  'errors.agent.log_store_failed': msg({
    id: 'errors.agent.log_store_failed',
    message: 'Taalcut couldn’t save this chat’s progress. Try again.',
  }),
  'errors.agent.skill_input_invalid': msg({
    id: 'errors.agent.skill_input_invalid',
    message: 'A step got instructions it couldn’t use, so it didn’t run. Try again.',
  }),
  'errors.agent.outside_skill': msg({
    id: 'errors.agent.outside_skill',
    message: 'That step reached for a tool its stage doesn’t allow, so it didn’t run.',
  }),
  'errors.agent.flow_violation': msg({
    id: 'errors.agent.flow_violation',
    message: 'That step came out of order, so it didn’t run.',
  }),
  'errors.agent.skill_not_found': msg({
    id: 'errors.agent.skill_not_found',
    message: 'That step isn’t in this version of Taalcut, so it didn’t run.',
  }),
  'errors.agent.external_level_too_low': msg({
    id: 'errors.agent.external_level_too_low',
    message:
      'This agent’s connection isn’t allowed to do that. Give it more access in Settings › External agents, then try again.',
  }),

  // @taalcut/tools
  'errors.tools.not_found': msg({
    id: 'errors.tools.not_found',
    message: 'That step isn’t in Taalcut now. Try again.',
  }),
  'errors.tools.invalid_output': msg({
    id: 'errors.tools.invalid_output',
    message: 'A step finished with a result Taalcut couldn’t use. Try again.',
  }),
  'errors.tools.permission_denied': msg({
    id: 'errors.tools.permission_denied',
    message: 'Your privacy settings don’t allow that step. Change them in Settings › Privacy to run it.',
  }),
  'errors.tools.denied': msg({
    id: 'errors.tools.denied',
    message: 'That step was turned down, so it didn’t run.',
  }),
  'errors.tools.awaiting_approval': msg({
    id: 'errors.tools.awaiting_approval',
    message: 'That step is waiting for your OK. Answer the question in the chat to go on.',
  }),
  'errors.tools.approval_required': msg({
    id: 'errors.tools.approval_required',
    message: 'That step needs your OK first, so it didn’t run. Try again and approve it.',
  }),
  'errors.tools.crashed': msg({
    id: 'errors.tools.crashed',
    message: 'A step failed inside Taalcut. Try again, and restart Taalcut if it keeps happening.',
  }),
  'errors.tools.scope_required': msg({
    id: 'errors.tools.scope_required',
    message: 'That step only runs inside a chat, so it didn’t run. Ask for it in a chat.',
  }),
  'errors.tools.service_unavailable': msg({
    id: 'errors.tools.service_unavailable',
    message: 'A part of Taalcut that step needs isn’t running. Restart Taalcut, then try again.',
  }),

  // The MCP gateway (Settings › External agents): an external agent's calls.
  'errors.mcp.awaiting_approval': msg({
    id: 'errors.mcp.awaiting_approval',
    message: 'An external agent’s step is waiting for your OK in Taalcut.',
  }),
  'errors.mcp.declined': msg({
    id: 'errors.mcp.declined',
    message: 'You declined that external agent’s step, so it didn’t run.',
  }),
  'errors.mcp.level_too_low': msg({
    id: 'errors.mcp.level_too_low',
    message: 'This connection can’t use that tool. Give it more access in Settings › External agents.',
  }),
  'errors.mcp.person_only': msg({
    id: 'errors.mcp.person_only',
    message: 'That change deletes or replaces something, so only you can redo it, here in Taalcut.',
  }),
  'errors.mcp.rate_limited': msg({
    id: 'errors.mcp.rate_limited',
    message:
      'An external agent sent too many requests at once. It can try again in {retryAfterSeconds, plural, one {# second} other {# seconds}}.',
  }),
  'errors.mcp.session_expired': msg({
    id: 'errors.mcp.session_expired',
    message: 'This connection expired after 90 days unused. Make a new one in Settings › External agents.',
  }),
  'errors.mcp.session_revoked': msg({
    id: 'errors.mcp.session_revoked',
    message: 'This connection was revoked. Make a new one in Settings › External agents.',
  }),
  'errors.mcp.too_many_sessions': msg({
    id: 'errors.mcp.too_many_sessions',
    message:
      'There are already {max} agent connections. Revoke one you don’t use in Settings › External agents, then try again.',
  }),

  // The sandbox: motion graphics and trial runs.
  'errors.sandbox.program_not_allowed': msg({
    id: 'errors.sandbox.program_not_allowed',
    message: 'That step tried to run a program Taalcut doesn’t allow, so it didn’t run.',
  }),
  'errors.sandbox.argument_rejected': msg({
    id: 'errors.sandbox.argument_rejected',
    message: 'That step asked for something Taalcut keeps closed off, so it didn’t run.',
  }),
  'errors.sandbox.path_outside': msg({
    id: 'errors.sandbox.path_outside',
    message: 'That step tried to reach a file outside its own folder, so it didn’t run.',
  }),
  'errors.sandbox.cpu_limit': msg({
    id: 'errors.sandbox.cpu_limit',
    message:
      'That step needed more processing than it’s allowed, so Taalcut stopped it. Try a simpler version.',
  }),
  'errors.sandbox.time_limit': msg({
    id: 'errors.sandbox.time_limit',
    message: 'That step took too long, so Taalcut stopped it. Try again.',
  }),
  'errors.sandbox.disk_limit': msg({
    id: 'errors.sandbox.disk_limit',
    message: 'That step wrote more files than it’s allowed, so Taalcut stopped it. Try a simpler version.',
  }),
  'errors.sandbox.experiment_not_found': msg({
    id: 'errors.sandbox.experiment_not_found',
    message: 'That trial run is gone. Ask Taalcut to start it again.',
  }),
  'errors.sandbox.discard_failed': msg({
    id: 'errors.sandbox.discard_failed',
    message: 'Taalcut couldn’t clear a trial run’s files. It tries again later, so there’s nothing to do.',
  }),

  // Core: the command bus, compute and memory.
  'errors.core.command_rollback_failed': msg({
    id: 'errors.core.command_rollback_failed',
    message:
      'A change didn’t save, and Taalcut couldn’t put things back as they were. Restart Taalcut to check the project.',
  }),
  'errors.core.command_source_refused': msg({
    id: 'errors.core.command_source_refused',
    message: 'Only you can make that change, because it decides what Taalcut may spend or share.',
  }),
  'errors.core.internal_command': msg({
    id: 'errors.core.internal_command',
    message: 'That action only runs through Undo and Redo.',
  }),
  'errors.core.compute_unavailable': msg({
    id: 'errors.core.compute_unavailable',
    message: 'There’s no chip here that can run that step, so it didn’t run.',
  }),
  'errors.core.memory_source_refused': msg({
    id: 'errors.core.memory_source_refused',
    message: 'Only you can change that memory, in Settings › Memory.',
  }),
  // EDT1-CMT: comments on a video, and the answers Taalcut gives them.
  'errors.core.comment_not_yours': msg({
    id: 'errors.core.comment_not_yours',
    message: 'Only you can change a comment you wrote.',
  }),
  'errors.core.comment_closed': msg({
    id: 'errors.core.comment_closed',
    message: 'That comment isn’t waiting for an answer any more, so it stays as it is.',
  }),
  'errors.core.comment_target_gone': msg({
    id: 'errors.core.comment_target_gone',
    message: 'That isn’t in the video any more, so there’s nothing to comment on.',
  }),
  'errors.core.comments_full': msg({
    id: 'errors.core.comments_full',
    message: 'This video already has {limit} comments, the most it can keep. Remove a few, then add yours.',
  }),

  // @taalcut/jobs: background tasks and downloads.
  'errors.jobs.unknown_job_kind': msg({
    id: 'errors.jobs.unknown_job_kind',
    message: 'This version of Taalcut can’t run that task. Update Taalcut, then try again.',
  }),
  'errors.jobs.handler_failed': msg({
    id: 'errors.jobs.handler_failed',
    message: 'A background task failed. Try again.',
  }),
  'errors.jobs.output_invalid': msg({
    id: 'errors.jobs.output_invalid',
    message: 'A background task finished with a result Taalcut couldn’t use. Try again.',
  }),
  'errors.jobs.invalid_job_state': msg({
    id: 'errors.jobs.invalid_job_state',
    message: 'That task has already moved on, so it can’t change now.',
  }),
  'errors.jobs.component_required': msg({
    id: 'errors.jobs.component_required',
    message: 'Another download needs this one, so it stays. Remove that one first.',
  }),

  // @taalcut/desktop: feedback and the cable.
  'errors.desktop.debug_bundle_unsafe': msg({
    id: 'errors.desktop.debug_bundle_unsafe',
    message: 'Part of the debug bundle looked private, so Taalcut didn’t save it. Nothing was sent.',
  }),
  'errors.desktop.feedback_unavailable': msg({
    id: 'errors.desktop.feedback_unavailable',
    message:
      'This copy of Taalcut can’t send feedback. Save the debug bundle instead, and share it yourself.',
  }),
  'errors.desktop.usb_unavailable': msg({
    id: 'errors.desktop.usb_unavailable',
    message:
      'Taalcut can’t use the cable connection right now. Restart Taalcut, or send the clips over Wi-Fi.',
  }),
};
