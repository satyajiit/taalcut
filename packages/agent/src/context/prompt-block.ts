// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ChatMessage } from '@taalcut/models';
import type { ResultReference } from './result-references';

/** One piece of the prompt, as messages.ts builds it from one transcript item. */
export interface PromptBlock {
  readonly kind: 'history' | 'user' | 'control' | 'turn' | 'saved';
  readonly messages: readonly ChatMessage[];
  /** The plan step the item was written in (TranscriptItem.step). */
  readonly step?: number;
  /** A turn's calls: tool, and how it ended. */
  readonly calls?: readonly { readonly tool: string; readonly failed?: string }[];
  /** Full registry results remain in the run log; these are exact, replay-stable readback addresses. */
  readonly references?: readonly ResultReference[];
  readonly readPages?: readonly ResultReference[];
}
