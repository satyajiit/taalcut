// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Replace only data with an exact readback address; assistant calls and decisions stay in their blocks. */
import type { PromptBlock } from './prompt-block';

export function compactExactResults(
  blocks: (PromptBlock | undefined)[],
  indexes: readonly number[],
  over: () => boolean,
  kind: 'readPages' | 'references',
): number {
  let count = 0;
  for (const index of indexes) {
    for (const reference of blocks[index]?.[kind] ?? []) {
      if (!over()) return count;
      const { message: at } = reference;
      const content =
        kind === 'references' && index !== indexes.at(-1)
          ? (reference.consumed ?? reference.content)
          : reference.content;
      const block = blocks[index]!;
      const message = block.messages[at];
      if (
        message?.role !== 'tool' ||
        typeof message.content !== 'string' ||
        message.content.length <= content.length
      )
        continue;
      blocks[index] = {
        ...block,
        messages: block.messages.map((item, position) => (position === at ? { ...message, content } : item)),
      };
      count++;
    }
  }
  return count;
}
