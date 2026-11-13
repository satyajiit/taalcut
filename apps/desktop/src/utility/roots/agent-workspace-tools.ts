// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-DSN in the agent process: the Designer's `workspace` tools over the library's workspace store
 * (WorkspaceStoreToken, workspace-store.ts), and what they read. Stills come from the render process's
 * `workspaceFrames` through main; the brief reads the video's look (its template's graphic system and its Style)
 * and its open comments; `workspace.promote` reads the template's graphics at its head; a composition's provenance
 * names the chat's model, the one the Designer runs on. Offered only where the store is, with the comments the
 * Designer answers (render's `render.designer` needs every one of its tools).
 */
import { z } from 'zod';
import {
  CommentStoreToken,
  err,
  graphicSystemSchema,
  idSchema,
  ok,
  renderWorkerOverRpc,
  StyleStoreToken,
  TemplateStoreToken,
  templateGraphicsSchema,
  TimelineStoreToken,
  ValidationError,
  WorkspaceStoreToken,
  commentToolView,
  defineToolModule,
  type Container,
  type GraphicSystem,
  type Style,
  type Timeline,
  type ToolModule,
} from '@taalcut/core';
import {
  workspaceToolModule,
  type DesignerOf,
  type TemplateGraphicsSource,
  type WorkspaceToolDeps,
} from '@taalcut/render';
import { renderTimelines } from '../../shared/render-ports';
import { AgentMainServicesToken, ModelProfilesToken, ModelRuntimeToken } from '../../shared/tokens';
import { LocalOnlyFlagToken } from './agent-local-only-flag';
import { workspaceShellToolsOf } from './workspace-shell';

/** Whether this process can offer the Designer: the workspace store and the comments it answers. */
export const canDesign = (container: Container): boolean =>
  container.has(WorkspaceStoreToken) && container.has(CommentStoreToken) && container.has(TimelineStoreToken);

/** The chat's model, the one the Designer runs on, for a composition's provenance. */
function designerModel(container: Container): DesignerOf {
  return async () => {
    if (!container.has(ModelProfilesToken) || !container.has(ModelRuntimeToken)) return null;
    const chain = container.resolve(ModelProfilesToken).resolve('agent');
    const first = chain.ok ? chain.value.choices[0] : undefined;
    if (!first) return null;
    const localOnly = container.has(LocalOnlyFlagToken) && container.resolve(LocalOnlyFlagToken).get();
    const onDevice = localOnly || container.resolve(ModelRuntimeToken).isLocalProvider(first.provider);
    return { id: `${first.provider}/${first.model}`, onDevice };
  };
}

/** What the brief reads of a stored template: its graphic system and its Style. */
const templateLookSchema = z.object({
  styleId: idSchema<'Style'>().nullable().optional(),
  graphics: z
    .object({ reading: z.object({ system: graphicSystemSchema }).nullable().optional() })
    .nullable()
    .optional(),
});

/** The video's look for the brief: its template's graphic system, and its Style (its own, else its template's). */
function lookOf(container: Container) {
  return async (timeline: Timeline): Promise<{ system: GraphicSystem | null; style: Style | null }> => {
    let system: GraphicSystem | null = null;
    let styleId = timeline.styleId ?? null;
    if (timeline.template && container.has(TemplateStoreToken)) {
      const stored = await container
        .resolve(TemplateStoreToken)
        .get(timeline.template.id, timeline.template.version);
      const parsed = stored.ok ? templateLookSchema.safeParse(stored.value.json) : null;
      if (parsed?.success) {
        system = parsed.data.graphics?.reading?.system ?? null;
        styleId ??= parsed.data.styleId ?? null;
      }
    }
    let style: Style | null = null;
    if (styleId && container.has(StyleStoreToken)) {
      const found = await container.resolve(StyleStoreToken).get(styleId);
      style = found.ok ? found.value : null;
    }
    return { system, style };
  };
}

/** A template's graphics at its head, as `template.setGraphics` replaces them. */
function templateGraphics(container: Container): TemplateGraphicsSource | undefined {
  if (!container.has(TemplateStoreToken)) return undefined;
  const store = container.resolve(TemplateStoreToken);
  return {
    async graphics(templateId) {
      const stored = await store.get(templateId);
      if (!stored.ok) return stored;
      const held = (stored.value.json as { graphics?: unknown } | null)?.graphics ?? null;
      if (held === null) return ok({ version: stored.value.version, graphics: null });
      const parsed = templateGraphicsSchema.safeParse(held);
      if (!parsed.success)
        return err(ValidationError({ field: 'graphics' }, { detail: "The template's graphics don't read" }));
      return ok({ version: stored.value.version, graphics: parsed.data });
    },
  };
}

/** The timeline's open and sent comments, as `comments.list` shows them. */
function openComments(container: Container) {
  const timelines = renderTimelines(container);
  return async (timelineId: Parameters<typeof timelines.get>[0]) => {
    const timeline = await timelines.get(timelineId);
    if (!timeline.ok) return timeline;
    const comments = await container
      .resolve(CommentStoreToken)
      .list(timelineId, { statuses: ['open', 'sent'] });
    if (!comments.ok) return comments;
    return ok(comments.value.map((comment) => commentToolView(comment, timeline.value)));
  };
}

/** What the workspace tools run on in this process (canDesign must hold). */
export function workspaceToolDepsOf(container: Container): WorkspaceToolDeps {
  const worker = container.has(AgentMainServicesToken)
    ? renderWorkerOverRpc(() => container.resolve(AgentMainServicesToken)().render)
    : undefined;
  const templates = templateGraphics(container);
  return {
    store: container.resolve(WorkspaceStoreToken),
    timelines: renderTimelines(container),
    ...(worker?.workspaceFrames ? { frames: worker.workspaceFrames } : {}),
    ...(templates ? { templates } : {}),
    look: lookOf(container),
    comments: openComments(container),
    designer: designerModel(container),
  };
}

/**
 * The `workspace` module: the Designer's tools where the store and the comments are, and the workspace shell's
 * (AGT2 sbx: workspace.open, exec, files, importMedia) where the store and the jobs are. One module, one workspace.
 */
export function workspaceToolModules(container: Container): ToolModule[] {
  const shell = workspaceShellToolsOf(container);
  const designer = canDesign(container) ? workspaceToolModule(workspaceToolDepsOf(container)).tools : [];
  const tools = [...designer, ...shell];
  return tools.length > 0 ? [defineToolModule({ id: 'workspace', tools })] : [];
}
