// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ConversationId, ProjectId, Timeline } from '@taalcut/core';

/** A project the Make fakes start with (seed.ts and each Phase 3 area's seed, p3/seeds). */
export interface SeededProject {
  readonly id: ProjectId;
  readonly name: string;
  readonly createdAt: number;
  readonly archivedAt: number | null;
  readonly timelines: readonly Timeline[];
  /** The chat that made it, when the chat fake seeds one for it; else an id by its place in the seed. */
  readonly conversationId?: ConversationId;
}
