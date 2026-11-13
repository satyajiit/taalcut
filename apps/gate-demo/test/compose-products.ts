// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ok } from '@taalcut/core';
import { productToolModule } from '@taalcut/agent';
import { createProductStore, type LibraryDatabase } from '@taalcut/library';

/** Existing recordings never generate product videos; discovery and reads still use the real product tools. */
export function demoProductModule(db: LibraryDatabase) {
  const store = createProductStore(db);
  return productToolModule({
    async list(input) {
      const limit = input.limit ?? 50;
      const found = await store.list({ ...input, limit: limit + 1 });
      return found.ok
        ? ok({
            items: [...found.value.slice(0, limit)],
            nextCursor: found.value.length > limit ? found.value[limit - 1]!.id : null,
          })
        : found;
    },
    knowledge: ({ productId, ...input }) => store.knowledgePage(productId, input),
  });
}
