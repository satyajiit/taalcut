// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH in the agent process: `video.done`, the Maker's finish, over the render store, the timelines and the
 * template a timeline follows (its slots' order gives their numbers, as QA's slot-match fixes name them).
 */
import {
  ClockToken,
  ok,
  RenderStoreToken,
  TemplateStoreToken,
  type AsyncResult,
  type Container,
  type TemplateRef,
  type ToolModule,
} from '@taalcut/core';
import {
  createVideoDoneLedger,
  makerDone,
  videoToolModule,
  type VideoDoneDeps,
  type VideoDoneLedger,
} from '@taalcut/render';
import { createTemplateService } from '@taalcut/templates';
import { renderTimelines } from '../../shared/render-ports';

/** The template version's slot ids in order; null without the template store. */
export function templateSlotOrder(
  container: Container,
): ((template: TemplateRef) => AsyncResult<readonly string[] | null>) | undefined {
  if (!container.has(TemplateStoreToken)) return undefined;
  return async (ref) => {
    const service = createTemplateService({
      store: container.resolve(TemplateStoreToken),
      clock: container.resolve(ClockToken),
    });
    const found = await service.get({ templateId: ref.id, version: ref.version });
    return found.ok ? ok(found.value.template.slots.map((slot) => slot.id as string)) : found;
  };
}

/** One ledger per agent process: video.done's passing reasons, which the Maker's own check reads. */
const ledgers = new WeakMap<Container, VideoDoneLedger>();
function ledgerOf(container: Container): VideoDoneLedger {
  let ledger = ledgers.get(container);
  if (!ledger) ledgers.set(container, (ledger = createVideoDoneLedger()));
  return ledger;
}

function videoDoneDeps(container: Container): VideoDoneDeps {
  const templateSlots = templateSlotOrder(container);
  return {
    store: container.resolve(RenderStoreToken),
    timelines: renderTimelines(container),
    ledger: ledgerOf(container),
    ...(templateSlots ? { templateSlots } : {}),
  };
}

/** The `video` module (video.done), offered beside render's. */
export function videoAgentToolModule(container: Container): ToolModule {
  return videoToolModule(videoDoneDeps(container));
}

/** The Maker's done-gate: video.done's verdict on a handoff (timeline's `MakerSkillDeps.done`); absent without renders. */
export function makerDoneOf(container: Container): ReturnType<typeof makerDone> | undefined {
  if (!container.has(RenderStoreToken)) return undefined;
  return makerDone(videoDoneDeps(container));
}
