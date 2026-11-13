// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { defineError } from '@taalcut/core';

export const ProductNoEvidence = defineError('agent.product_no_evidence', { retryable: true });
export const ProductNoFreshIdeas = defineError('agent.product_no_fresh_ideas', { retryable: true });
export const ProductArchived = defineError('agent.product_archived', { retryable: false });
export const ProductDraftLimit = defineError('agent.product_draft_limit', { retryable: true });
export const ProductEvidenceChanged = defineError('agent.product_evidence_changed', { retryable: true });
