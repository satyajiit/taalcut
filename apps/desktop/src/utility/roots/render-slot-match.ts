// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The render engine's `slotMatch` port (AGT2-MATCH): for a draft whose timeline follows a template, that template
 * version (read and migrated from the library's store) and timeline's `slotShots` over the library's shot profiles,
 * each slot's needs embedded by the jobs process's model through main (as the agent's casting does). The space opens
 * on the first draft and is asked for again at most every 30 s while the jobs process doesn't serve it; until then a
 * need is read by its words only. A timeline that follows no template gives null, and QA skips the slot checks.
 */
import {
  embedderOverRpc,
  ok,
  type Clock,
  type Container,
  type Embedder,
  type EmbeddingSpace,
  type VectorIndex,
} from '@taalcut/core';
import { createShotProfileSource, createTemplateStore, openVectorIndex } from '@taalcut/library';
import type { RenderEngineDeps } from '@taalcut/render';
import { createTemplateService } from '@taalcut/templates';
import { slotShots } from '@taalcut/timeline';
import { templateAssetsDir } from '../../shared/template-assets';
import { LibraryDatabaseToken } from '../../shared/tokens';
import type { renderMainClient } from './render-runner';

const SPACE_RETRY_MS = 30_000;

type MainClient = NonNullable<ReturnType<typeof renderMainClient>>;

interface ActiveSpace {
  readonly index: VectorIndex;
  readonly embedder: Embedder;
}

function lazySpace(container: Container, main: MainClient | undefined) {
  let active: ActiveSpace | undefined;
  let lastTry = Number.NEGATIVE_INFINITY;
  return async (): Promise<ActiveSpace | undefined> => {
    if (active || !main || Date.now() - lastTry < SPACE_RETRY_MS) return active;
    lastTry = Date.now();
    try {
      const space: EmbeddingSpace = await main.embeddings.space();
      const index = openVectorIndex(container.resolve(LibraryDatabaseToken), {
        name: space.indexName,
        dimensions: space.dimensions,
      });
      if (index.ok) active = { index: index.value, embedder: embedderOverRpc(() => main.embeddings, space) };
    } catch {
      // The embedding model isn't served yet: needs are read by their words.
    }
    return active;
  };
}

export function renderSlotMatch(
  container: Container,
  config: { readonly userData: string },
  clock: Clock,
  main: MainClient | undefined,
): Pick<RenderEngineDeps, 'slotMatch'> {
  if (!container.has(LibraryDatabaseToken)) return {};
  const space = lazySpace(container, main);
  return {
    slotMatch: async ({ timeline, signal }) => {
      const ref = timeline.template;
      if (!ref) return ok(null);
      const db = container.resolve(LibraryDatabaseToken);
      const templates = createTemplateService({
        store: createTemplateStore(db, { assetsDir: templateAssetsDir(config.userData) }),
        clock,
      });
      const found = await templates.get({ templateId: ref.id, version: ref.version });
      if (!found.ok) return found;
      const active = await space();
      const shots = await slotShots(timeline, found.value.template, {
        profiles: createShotProfileSource({ db, vectors: () => active?.index ?? null }),
        ...(active ? { embedder: active.embedder } : {}),
        ...(signal ? { signal } : {}),
      });
      return shots.ok ? ok({ template: found.value.template, shots: shots.value }) : shots;
    },
  };
}
