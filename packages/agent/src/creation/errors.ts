// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { defineError } from '@taalcut/core';

export const CreationApprovalRequired = defineError('agent.creation_approval_required');
export const CreationOutputInvalid = defineError('agent.creation_output_invalid', { retryable: true });
export const CreationBudgetExceeded = defineError('agent.creation_budget_exceeded');
export const CreationReviewFailed = defineError('agent.creation_review_failed', { retryable: true });
export const CreationInputsChanged = defineError('agent.creation_inputs_changed', { retryable: true });
export const CreationInterruptedCharge = defineError('agent.creation_interrupted_charge');
