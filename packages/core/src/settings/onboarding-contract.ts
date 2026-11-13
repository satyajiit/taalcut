// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Onboarding progress (P2-X4, P3-B3): which step to open, where inside it,
 * when it started and how it ended. `appContract.onboarding` (owner agent)
 * reads it; the renderer moves it on with `onboarding.setProgress` (write,
 * person sources only, no inverse) and "Run setup again" sends
 * `onboarding.reset` (inverse: the previous progress). Handlers in
 * @taalcut/agent over ONBOARDING_SETTING; a stored Phase 2 progress parses
 * with an empty branch and no end.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { ipc } from '../ipc/contract';
import { defineSetting } from '../ports/preferences';

export const ONBOARDING_STEP_IDS = [
  'alpha',
  'beta',
  'thinking',
  'hardware',
  'sources',
  'import',
  'first-video',
] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];

export const ONBOARDING_THINKING_BRANCHES = ['chatgpt', 'subscription', 'api-key', 'local-only'] as const;
export const ONBOARDING_SOURCE_BRANCHES = ['folder', 'wifi', 'cable', 'later'] as const;
export const ONBOARDING_ENDINGS = ['finished', 'skipped'] as const;

/** Where inside a step the person was, so a resume reopens it there. */
export const onboardingBranchSchema = z.object({
  thinking: z.enum(ONBOARDING_THINKING_BRANCHES).optional(),
  source: z.enum(ONBOARDING_SOURCE_BRANCHES).optional(),
  starterPicker: z.boolean().optional(),
});
export type OnboardingBranch = z.output<typeof onboardingBranchSchema>;

export const onboardingProgressSchema = z.object({
  /** The step to open; null before the first. */
  step: z.enum(ONBOARDING_STEP_IDS).nullable(),
  startedAt: z.int().nonnegative().nullable(),
  completedAt: z.int().nonnegative().nullable(),
  branch: onboardingBranchSchema.default({}),
  /** How first run ended; null while it runs. */
  completedVia: z.enum(ONBOARDING_ENDINGS).nullable().default(null),
});
export type OnboardingProgress = z.output<typeof onboardingProgressSchema>;

export const ONBOARDING_SETTING = defineSetting('onboarding.progress', onboardingProgressSchema, {
  step: null,
  startedAt: null,
  completedAt: null,
  branch: {},
  completedVia: null,
});

export const ONBOARDING_COMMANDS = {
  setProgress: 'onboarding.setProgress',
  reset: 'onboarding.reset',
  /** Round P3-3: reset's inverse, the progress as it was. Internal: only undo and redo run it. */
  restore: 'onboarding.restore',
} as const;

export const onboardingCommandPayloads = {
  [ONBOARDING_COMMANDS.setProgress]: z.object({
    step: z.enum(ONBOARDING_STEP_IDS),
    completed: z.boolean().optional(),
    /** With completed: how it ended (Skip sends 'skipped'). */
    via: z.enum(ONBOARDING_ENDINGS).optional(),
    branch: onboardingBranchSchema.optional(),
  }),
  [ONBOARDING_COMMANDS.reset]: z.object({}),
  [ONBOARDING_COMMANDS.restore]: onboardingProgressSchema,
};

/** appContract.onboarding, owner agent. */
export const onboardingContract = { state: ipc.output(onboardingProgressSchema) };
