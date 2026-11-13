// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1 tpl in the agent process: a make's frame checks. Once the agent's `timeline.assemble` creates timelines,
 * each one's composition graphics are drawn over its footage by the render worker and checked (render's
 * `checkFills`: the render's frame checks, the safe rect, the heads FRM1's tracks know). A failure goes back to the
 * Designer with the frames, when one is given, and a design that passes moves every graphic drawn with it to the new
 * version (`graphics.setComposition`, an undoable step). What still fails is logged; QA says it again at export.
 * Recorded e2e sessions run no checks. Never throws.
 */
import {
  AuditLogStoreToken,
  ClockToken,
  CommandBusToken,
  GRAPHICS_COMMANDS,
  renderWorkerOverRpc,
  SubjectSourceToken,
  TemplateStoreToken,
  TIMELINE_COMMANDS,
  TimelineStoreToken,
  type CommandOrigin,
  type Container,
  type GraphicItem,
  type RenderWorker,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import { checkFills, compositionBriefs, type DesignOverlay } from '@taalcut/render';
import { createTemplateService } from '@taalcut/templates';
import { checkSceneOf, migrateTimeline } from '@taalcut/timeline';
import { AgentMainServicesToken } from '../../shared/tokens';
import { LIBRARY_STORE_KEEPS_METADATA } from './agent-templates';

const log = (line: string) => console.warn(`[fill-checks] ${line}`);
const RECORDED_MODELS_ENV = 'TAALCUT_TEST_RECORDED_MODELS';
const ORIGIN: CommandOrigin = { source: 'agent', actor: 'agent:fill-checks' };

/** Checks one made timeline's composition graphics; redesigns the ones that fail when a Designer is given. */
export async function checkMadeTimeline(
  container: Container,
  worker: RenderWorker,
  timeline: Timeline,
  design: DesignOverlay | undefined,
): Promise<void> {
  if (!worker.workspaceFrames || !(timeline.graphicCompositions?.length ?? 0)) return;
  const frames = worker.workspaceFrames.bind(worker);
  const subjects = container.has(SubjectSourceToken) ? container.resolve(SubjectSourceToken) : undefined;
  const scene = await checkSceneOf(timeline, subjects);
  const template =
    timeline.template && container.has(TemplateStoreToken)
      ? await createTemplateService({
          store: container.resolve(TemplateStoreToken),
          clock: container.resolve(ClockToken),
          libraryMetadata: LIBRARY_STORE_KEEPS_METADATA,
        }).get({ templateId: timeline.template.id })
      : null;
  const briefs = template?.ok ? compositionBriefs(template.value.template) : [];
  const result = await checkFills(timeline, {
    projectId: timeline.projectId,
    frames: (input, signal) => frames(input, signal ? { signal } : {}),
    scene,
    ...(design ? { design } : {}),
    briefFor: (_composition, items: readonly GraphicItem[]) =>
      briefs.find((brief) =>
        brief.overlays.some((overlay) => items.some((item) => item.overlay?.id === overlay.overlayId)),
      ) ?? null,
  });
  const bus = container.resolve(CommandBusToken);
  for (const redesign of result.redesigns) {
    const set = await bus.dispatch(
      GRAPHICS_COMMANDS.setComposition,
      {
        projectId: timeline.projectId,
        timelineId: timeline.id,
        itemIds: [...redesign.itemIds],
        composition: redesign.composition,
      },
      ORIGIN,
    );
    if (!set.ok) log(`${timeline.id}: the new design was not set (${set.error.code})`);
  }
  for (const finding of result.findings)
    log(`${timeline.id} ${finding.itemId} ${finding.check}: ${finding.detail}`);
  for (const warning of scene.warnings) log(`${timeline.id}: ${warning}`);
}

/** Checks the composition graphics of every timeline the agent's make creates, one at a time, in the background. */
export function startFillChecks(container: Container, design?: DesignOverlay): void {
  if (process.env[RECORDED_MODELS_ENV] || !container.has(AuditLogStoreToken)) return;
  if (!container.has(AgentMainServicesToken) || !container.has(TimelineStoreToken)) return;
  const worker = renderWorkerOverRpc(() => container.resolve(AgentMainServicesToken)().render);
  const bus = container.resolve(CommandBusToken);
  let queue = Promise.resolve();
  bus.subscribe((change) => {
    if (change.kind !== 'executed' || change.name !== TIMELINE_COMMANDS.create) return;
    if (change.origin.source !== 'agent') return;
    queue = queue
      .then(async () => {
        const recent = await container
          .resolve(AuditLogStoreToken)
          .listByProject(change.projectId, { limit: 20 });
        const entry = recent.ok ? recent.value.find((candidate) => candidate.id === change.id) : undefined;
        const made = (entry?.payload as { timelines?: { id?: TimelineId }[] } | undefined)?.timelines ?? [];
        for (const { id } of made) {
          if (!id) continue;
          const stored = await container.resolve(TimelineStoreToken).get(id);
          const timeline = stored.ok ? migrateTimeline(stored.value.json, stored.value.schemaVersion) : null;
          if (timeline?.ok) await checkMadeTimeline(container, worker, timeline.value, design);
        }
      })
      .catch((cause: unknown) => log(`checks stopped (${String(cause).slice(0, 200)})`));
  });
}
