// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `voiceFinalize` extension (SPEC sections 25 and 28): before the Reviewer, when the timeline's voiceover
 * still has draft lines, the agent calls `voice.finalize` itself (a tool step, no model turn) so the review
 * hears the final voice. Its estimate card comes first through the tool's own cost estimate (section 14).
 */
import { ok, type AsyncResult } from '@taalcut/core';
import { flowFacts } from '../../flows';
import type { FlowExtension } from '../extensions';

export const VOICE_FINALIZE_EXTENSION = 'voiceFinalize';
export const VOICE_FINALIZE_TOOL = 'voice.finalize';

export interface VoiceFinalizeDeps {
  /** How many lines of the timeline's voiceover are drafts (0 with no voiceover). */
  readonly draftLines: (timelineId: string, signal: AbortSignal) => AsyncResult<number>;
}

export function voiceFinalizeExtension(deps: VoiceFinalizeDeps): FlowExtension {
  return {
    id: VOICE_FINALIZE_EXTENSION,
    anchor: { before: 'reviewer' },
    step: { tool: VOICE_FINALIZE_TOOL, labelKey: 'flows.step.voiceFinalize' },
    async when(state, ctx) {
      const timelineId = flowFacts(state, ctx.anchor).timelineId;
      if (typeof timelineId !== 'string') return ok({ join: false });
      const drafts = await deps.draftLines(timelineId, ctx.signal);
      if (!drafts.ok) return drafts;
      return ok({ join: drafts.value > 0 });
    },
  };
}
