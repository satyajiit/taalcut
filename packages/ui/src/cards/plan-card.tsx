// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: plan · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.2 (A3) · states: see run-block */

import type { CardOf } from '@taalcut/core';
import { RunBlock } from '../chat/run-block';

/**
 * The agent's plan (PRD 7.1): shown before it changes anything, then ticked
 * off step by step. On its own it is a run block without calls; the chat puts
 * the run's tool calls under their steps (see RunBlock).
 */
export function PlanCard({ card }: { card: CardOf<'plan'> }) {
  return <RunBlock plan={card} />;
}
