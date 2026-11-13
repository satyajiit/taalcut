// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `workspace.promote` (HFW1 "dsn"): a design the person liked goes into the template the video was made from, so
 * the next video made from it draws its overlays with it (`template.setGraphics`, over the template's version). It
 * changes what every later make gets, so it always asks, at every autonomy level, as memory.remember does.
 */
import {
  err,
  graphicComponentsSchema,
  NO_TOOL_RETRY,
  NotFoundError,
  NotImplementedError,
  ok,
  TEMPLATE_COMMANDS,
  ulidSchema,
  ValidationError,
  type GraphicComponents,
} from '@taalcut/core';
import { z } from 'zod';
import type { WorkspaceToolDeps } from './deps';
import { keyOf, LOCAL, workspaceTool } from './tool-parts';

export function workspacePromoteTool(deps: WorkspaceToolDeps) {
  return workspaceTool({
    name: 'workspace.promote',
    description:
      "Keeps a placed composition in the video's template, so videos made from it later draw these overlays " +
      "with it: the composition (the timeline's newest version of it) joins the template's graphics, and each " +
      'overlayIds overlay is drawn with it. Only when the person asks to keep the design for the template. The ' +
      'person is always asked first.',
    summary: "Keeps a design in the video's template for later videos (asks first).",
    tags: ['workspace', 'promote', 'template', 'keep', 'save', 'composition'],
    input: z.object({
      projectId: ulidSchema('Project'),
      templateId: ulidSchema('Template'),
      timelineId: ulidSchema('Timeline'),
      compositionId: ulidSchema('GraphicComposition'),
      overlayIds: z.array(ulidSchema('TextOverlay')).max(24).default([]),
    }),
    output: z.object({ templateId: ulidSchema('Template'), version: z.int().min(1), compositions: z.int().min(1) }),
    command: TEMPLATE_COMMANDS.setGraphics,
    sideEffect: 'write',
    alwaysAsk: true,
    timeoutMs: 15_000,
    retry: NO_TOOL_RETRY,
    permission: LOCAL,
    idempotencyKey: keyOf('workspace.promote'),
    describeCall: (input) => `${input.overlayIds.length}`,
    run: async (input, ctx) => {
      if (!deps.templates)
        return err(NotImplementedError({ feature: 'workspace.promote' }, { detail: 'No templates here' }));
      const timeline = await deps.timelines.get(input.timelineId);
      if (!timeline.ok) return timeline;
      const copy = (timeline.value.graphicCompositions ?? [])
        .filter((entry) => entry.id === input.compositionId)
        .sort((a, b) => b.version - a.version)[0];
      if (!copy) return err(NotFoundError({ entity: 'graphicComposition', id: input.compositionId }));
      const template = await deps.templates.graphics(input.templateId);
      if (!template.ok) return template;
      const held = template.value.graphics;
      const overlays = new Set<string>(input.overlayIds);
      const graphics: GraphicComponents = {
        uses: [
          ...(held?.uses ?? []).filter((use) => !overlays.has(use.overlayId)),
          ...input.overlayIds.map((overlayId) => ({ overlayId, compositionId: copy.id })),
        ],
        compositions: [...(held?.compositions ?? []).filter((entry) => entry.id !== copy.id), copy],
      };
      const checked = graphicComponentsSchema.safeParse(graphics);
      if (!checked.success)
        return err(ValidationError({ field: 'graphics' }, { detail: z.prettifyError(checked.error) }));
      const done = await ctx.dispatch({
        projectId: input.projectId,
        templateId: input.templateId,
        baseVersion: template.value.version,
        graphics: checked.data,
      });
      if (!done.ok) return done;
      const version = (done.value as { version?: unknown } | null)?.version;
      return ok({
        templateId: input.templateId,
        version: typeof version === 'number' ? version : template.value.version + 1,
        compositions: checked.data.compositions?.length ?? 1,
      });
    },
  });
}
