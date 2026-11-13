// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** G8: what a run reads from the usage limits (models' tracker), so a rateLimit card leaves out limited models. */
import type { UsageLimit } from '@taalcut/core';

/** What the agent reads from the usage limits (models' tracker): other models of a module that are limited too. */
export interface RateLimitDeps {
  readonly current: () => readonly UsageLimit[];
}
