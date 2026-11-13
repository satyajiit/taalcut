// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V10: brand kits and looks as @taalcut/templates' styles service answers them (appContract.styles), and the
 * commands that change them and apply them: style.*, template.setStyle, timeline.setStyle and batch.applyStyle
 * (P3-V16), each with its inverse. fake-phase3.ts serves `router` as the `styles` namespace.
 *
 * Seeded: two brand kits (Chai & Co., the default for new videos; Monsoon Travels) and one look (Warm film):
 * phase3/styles/style-seed.ts. `importImage` decides from the picked path (phase3/styles/style-images.ts).
 */
import { appContract, implementContract, toRpcError, type AnyCommand } from '@taalcut/core';
import { GOLDEN_TIMELINES } from '../make/ids';
import type { Phase3Deps } from './phase3-deps';
import { createApplyCommands } from './styles/apply-commands';
import { createStyleCommands } from './styles/style-commands';
import { importImage } from './styles/style-images';
import { createStyleState } from './styles/style-state';

export interface FakeStylesOptions {
  /** No brand kits at all (the empty page). */
  readonly empty?: boolean;
  /**
   * Golden hour market's second and third videos start without captions, so a caption preset applied to the
   * project skips them ('noCaptions'). The seed's projects stay as they are otherwise.
   */
  readonly uncaptioned?: boolean;
}

export function createFakeStyles(deps: Phase3Deps, options: FakeStylesOptions = {}) {
  const store = createStyleState(deps, options.empty !== true);
  if (options.uncaptioned) {
    for (const id of GOLDEN_TIMELINES.slice(1)) {
      const timeline = deps.make.timelines.get(id);
      if (timeline) deps.make.timelines.replace(timeline.projectId, { ...timeline, captions: null });
    }
  }
  const os = implementContract(appContract.styles);
  const router = os.router({
    list: os.list.handler(() => store.list()),
    get: os.get.handler(({ input }) => {
      const found = store.get(input.styleId);
      if (!found.ok) throw toRpcError(found.error);
      return found.value;
    }),
    usedBy: os.usedBy.handler(async ({ input }) => {
      const usage = await store.usedBy(input.styleId);
      if (!usage.ok) throw toRpcError(usage.error);
      return usage.value;
    }),
    importImage: os.importImage.handler(async ({ input }) => {
      const imported = await importImage(input.path);
      if (!imported.ok) throw toRpcError(imported.error);
      return imported.value;
    }),
  });
  const commands: AnyCommand[] = [
    ...createStyleCommands(store, { settings: deps.settings, now: deps.now }),
    ...createApplyCommands({ store, templates: deps.templates, timelines: deps.make.timelines }),
  ];
  return { router, commands, store };
}

export type FakeStyles = ReturnType<typeof createFakeStyles>;
