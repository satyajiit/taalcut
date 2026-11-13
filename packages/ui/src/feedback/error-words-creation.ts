// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

export const CREATION_ERROR_WORDS: Readonly<Record<string, MessageDescriptor>> = {
  'errors.agent.creation_approval_required': msg({
    id: 'errors.agent.creation_approval_required',
    message:
      'Review the current script and visual preview, answer the required questions, then approve the draft to create your video.',
  }),
  'errors.agent.creation_output_invalid': msg({
    id: 'errors.agent.creation_output_invalid',
    message: 'A creation step returned a result Taalcut couldn’t use. Resume creation to try again.',
  }),
  'errors.agent.creation_budget_exceeded': msg({
    id: 'errors.agent.creation_budget_exceeded',
    message: 'Creation reached its spending limit. Review the project budget before resuming.',
  }),
  'errors.agent.creation_review_failed': msg({
    id: 'errors.agent.creation_review_failed',
    message: 'The video didn’t pass its visual review. Resume creation to revise it.',
  }),
  'errors.agent.creation_inputs_changed': msg({
    id: 'errors.agent.creation_inputs_changed',
    message:
      'The brief or sources changed while Taalcut was working. Review the refreshed draft before approving it again.',
  }),
  'errors.agent.creation_interrupted_charge': msg({
    id: 'errors.agent.creation_interrupted_charge',
    message:
      'Creation stopped during a provider call that may have been charged. Choose Retry paid work in Production to continue with a possible additional charge.',
  }),
  'errors.tools.creation_source_failed': msg({
    id: 'errors.tools.creation_source_failed',
    message:
      'Taalcut couldn’t read this source. Check the URL or choose the project folder again, then research your sources.',
  }),
  'errors.tools.creation_project_unsupported': msg({
    id: 'errors.tools.creation_project_unsupported',
    message:
      'Taalcut can’t run this project’s demo yet. Add its public website URL or product screenshots instead.',
  }),
  'errors.tools.creation_logo_failed': msg({
    id: 'errors.tools.creation_logo_failed',
    message: 'Taalcut couldn’t load the brand logo. Try again, or add the original logo from your library.',
  }),
};
