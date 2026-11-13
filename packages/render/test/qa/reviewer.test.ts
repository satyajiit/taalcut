// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The post-export review check (a finished render's report, the supersede
 * chain): registrable shapes and the deterministic check before the Editor
 * gets the steps. The draft Reviewer skill is reviewer-draft.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  CAPTION_COMMANDS,
  MUSIC_COMMANDS,
  newId,
  REFERENCE_AUDIO_TERMS_VERSION,
  type QaFix,
} from '@taalcut/core';
import {
  postExportReviewSchema,
  verifyReviewerHandoff,
  type ReviewerHandoff,
} from '../../src/skills/review-checks';
import { target } from './support';

const moveCaptions: QaFix = {
  kind: 'command',
  labelKey: 'qa.fixes.moveCaptions',
  command: CAPTION_COMMANDS.setStyle,
  payload: { ...target, style: { anchorY: 0.6 } },
};
const swap: QaFix = { kind: 'agent', instructionKey: 'qa.fixes.swapOrTrimStatic', params: { clipId: 'clip-a' } };

function handoff(overrides: Partial<ReviewerHandoff> = {}): ReviewerHandoff {
  return {
    renderId: newId<'Render'>(),
    verdict: 'needsAttention',
    round: 1,
    editorSteps: [
      { checkId: 'captionSafeZone', fix: moveCaptions },
      { checkId: 'frozenFrames', fix: swap },
    ],
    next: 'reexport',
    ...overrides,
  };
}

describe('post-export review check', () => {
  it('parses a handoff', () => {
    expect(postExportReviewSchema.parse(handoff({ round: 2 })).round).toBe(2);
  });

  it('passes command fixes copied from the report and agent judgment calls', () => {
    expect(verifyReviewerHandoff(handoff())).toEqual({ verdict: 'pass' });
    const rights: QaFix = {
      kind: 'command',
      labelKey: 'qa.fixes.usePlatformSound',
      command: MUSIC_COMMANDS.choosePath,
      payload: { ...target, choice: { path: 'platformSound' } },
    };
    expect(verifyReviewerHandoff(handoff({ editorSteps: [{ checkId: 'rightsReferenceAudio', fix: rights }], next: 'user' }))).toEqual({
      verdict: 'pass',
    });
  });

  it('accepts the reference-audio warning command only as the report gives it', () => {
    const warning: QaFix = {
      kind: 'command',
      labelKey: 'qa.fixes.referenceAudioWarning',
      command: MUSIC_COMMANDS.openReferenceAudioWarning,
      payload: { projectId: target.projectId, termsVersion: REFERENCE_AUDIO_TERMS_VERSION },
    };
    expect(verifyReviewerHandoff(handoff({ editorSteps: [{ checkId: 'rightsReferenceAudio', fix: warning }], next: 'user' })).verdict).toBe(
      'pass',
    );
  });

  it('retries a re-export at the last round: the user decides then', () => {
    expect(verifyReviewerHandoff(handoff({ round: 3 })).verdict).toBe('retry');
    expect(verifyReviewerHandoff(handoff({ round: 3, next: 'user' })).verdict).toBe('pass');
  });

  it('retries a re-export with nothing for the Editor to do', () => {
    expect(verifyReviewerHandoff(handoff({ editorSteps: [] })).verdict).toBe('retry');
  });

  it('retries auto fixes, which the render process already applied', () => {
    const auto: QaFix = { kind: 'auto', action: 'rerender' };
    expect(verifyReviewerHandoff(handoff({ editorSteps: [{ checkId: 'blackFrames', fix: auto }] })).verdict).toBe('retry');
  });

  it('retries an unknown command and a payload edited out of shape', () => {
    const unknown: QaFix = { ...moveCaptions, command: 'timeline.teleport' };
    expect(verifyReviewerHandoff(handoff({ editorSteps: [{ checkId: 'beatSync', fix: unknown }] }))).toMatchObject({
      verdict: 'retry',
      reason: expect.stringContaining('Unknown command'),
    });
    const edited: QaFix = { ...moveCaptions, payload: { style: { anchorY: 'low' } } };
    expect(verifyReviewerHandoff(handoff({ editorSteps: [{ checkId: 'captionSafeZone', fix: edited }] })).verdict).toBe('retry');
  });
});
