// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';
import type { CreationProject, CreationTask } from '@taalcut/core';

export const CREATION_STATUS = {
  draft: msg`Brief`,
  researching: msg`Researching`,
  'awaiting-approval': msg`Ready for review`,
  producing: msg`Creating video`,
  ready: msg`Ready to edit`,
  failed: msg`Needs attention`,
  cancelled: msg`Stopped`,
} satisfies Record<CreationProject['status'], ReturnType<typeof msg>>;
export const TASK_ROLES = {
  director: msg`Director`,
  researcher: msg`Research`,
  writer: msg`Script`,
  designer: msg`Design`,
  voice: msg`Voiceover`,
  reviewer: msg`Review`,
} satisfies Record<CreationTask['role'], ReturnType<typeof msg>>;
export const TASK_STATUS = {
  queued: msg`Waiting`,
  running: msg`Working`,
  completed: msg`Complete`,
  failed: msg`Needs attention`,
  cancelled: msg`Stopped`,
} satisfies Record<CreationTask['status'], ReturnType<typeof msg>>;
export const TASK_ACTIVITY = {
  director: msg`Coordinating your video`,
  researcher: msg`Researching your sources`,
  writer: msg`Writing the script`,
  designer: msg`Designing the scenes`,
  voice: msg`Preparing the voiceover`,
  reviewer: msg`Reviewing the finished video`,
} satisfies Record<CreationTask['role'], ReturnType<typeof msg>>;
export const CREATION_STEPS = ['brief', 'research', 'script', 'design', 'production'] as const;
export type CreationStep = (typeof CREATION_STEPS)[number];
export const STEP_WORDS = {
  brief: msg`Brief & sources`,
  research: msg`Research`,
  script: msg`Script`,
  design: msg`Design`,
  production: msg`Production`,
};
