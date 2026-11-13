// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1 tpl in the agent process: once a template is made from a reel, its graphics are designed in the background
 * as compositions (render's `designTemplateCompositions`, by the Designer: agent-designer.ts), so they are ready
 * before its first make, and set on it with `template.setGraphics` (a new version, undoable). It runs once, for a
 * template with graphic overlays (timeline's `isGraphicOverlay`) and no compositions yet. An overlay no design
 * passed for is left out of a make: there is no ready-made design to fall back to.
 *
 * The Designer works in the workspace of the project the template was made in (the command's). The vision judge
 * runs on the chat's model when it can see images, else the vision chain, which under Local only keeps the models on
 * this Mac. The reel's frames are a reference's, which go to a model without a card since FIX-CONSENT, as DSG1-READ's
 * sheets do. Recorded e2e sessions carry no design calls: they design nothing.
 */
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  AuditLogStoreToken,
  ClockToken,
  CommandBusToken,
  err,
  newId,
  NotImplementedError,
  ok,
  renderWorkerOverRpc,
  TEMPLATE_COMMANDS,
  TemplateMediaStoreToken,
  TemplateStoreToken,
  WorkspaceStoreToken,
  type AuditLogStore,
  type CommandBus,
  type CommandOrigin,
  type Container,
  type GraphicComponents,
  type ProjectId,
  type Template,
  type TemplateId,
  type TemplateMediaStore,
} from '@taalcut/core';
import type { ModelChoice } from '@taalcut/models';
import { designTemplateCompositions, type JudgeModel, type TemplateDesignOutcome } from '@taalcut/render';
import { createTemplateService, type TemplateService } from '@taalcut/templates';
import { isGraphicOverlay } from '@taalcut/timeline';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import {
  AgentMainServicesToken,
  ModelClientToken,
  ModelProfilesToken,
  ModelRuntimeToken,
} from '../../shared/tokens';
import { templateDesignerOf } from './agent-designer';
import { templateCompositionDeps } from './agent-template-design';
import { LIBRARY_STORE_KEEPS_METADATA } from './agent-templates';
import { mediaBinaries } from './media-jobs';
import {
  TemplateDesignTrackerToken,
  type DesignSettled,
  type TemplateDesignTracker,
} from './template-design-tracker';

const log = (line: string) => console.warn(`[graphics] ${line}`);
/** agent-recorded-models.ts's variable, named here so a release bundle never imports that test-only module. */
const RECORDED_MODELS_ENV = 'TAALCUT_TEST_RECORDED_MODELS';
const ORIGIN: CommandOrigin = { source: 'agent', actor: 'agent:template-design' };

/** The chat's model, when it takes images; null otherwise. */
export function chatModelSeeing(container: Container): ModelChoice | null {
  if (!container.has(ModelProfilesToken) || !container.has(ModelRuntimeToken)) return null;
  const chain = container.resolve(ModelProfilesToken).resolve('agent');
  const first = chain.ok ? chain.value.choices[0] : undefined;
  if (!first) return null;
  const info = container.resolve(ModelRuntimeToken).findModel(first.provider, first.model, 'chat');
  return info?.input.includes('image') ? first : null;
}

/** The vision judge's model over this process's ModelClient: the chat's when it sees images, else the vision chain. */
export function judgeModelOf(container: Container): JudgeModel {
  return {
    async complete(request, signal) {
      if (!container.has(ModelClientToken))
        return err(NotImplementedError({ feature: 'template design' }, { detail: 'No model client' }));
      const chat = chatModelSeeing(container);
      const base = {
        module: 'vision' as const,
        system: request.system,
        messages: request.messages.map((message) => ({
          role: 'user' as const,
          content: [...message.content],
        })),
        maxTokens: request.maxTokens,
        temperature: 0.2,
        reasoning: 'off' as const,
        trace: { spanId: newId<'Span'>() },
        ...(signal ? { signal } : {}),
      };
      const client = container.resolve(ModelClientToken);
      const answer = chat
        ? await client.complete({ ...base, target: { ...chat, reasoning: 'off' } })
        : await client.complete(base);
      if (!answer.ok) {
        log(`template design: the judge failed (${answer.error.code})`);
        return answer;
      }
      const { text, provider, model } = answer.value;
      return ok({ text, provider, model });
    },
  };
}

/**
 * The template's kept reel. `templates.finalise` keeps it just after its `template.create` commits, so it is waited
 * for: every `everyMs` up to `tries` times. Null when there is none (a store that refused it, a template not made
 * from a reel).
 */
export async function keptReel(
  media: Pick<TemplateMediaStore, 'get'>,
  templateId: TemplateId,
  { tries = 60, everyMs = 2_000 }: { tries?: number; everyMs?: number } = {},
): Promise<string | null> {
  for (let attempt = 1; attempt <= tries; attempt++) {
    const kept = await media.get(templateId);
    if (kept.ok && kept.value) return kept.value.path;
    if (attempt < tries) await delay(everyMs);
  }
  return null;
}

/** What one template's design needs from the app; the stand-ins' seam in tests. */
export interface TemplateDesigning {
  readonly bus: Pick<CommandBus, 'subscribe' | 'dispatch'>;
  readonly audit: Pick<AuditLogStore, 'listByProject'>;
  readonly templates: Pick<TemplateService, 'get'>;
  /** FIX-GFXWAIT: where a running design is recorded, so a make from the template waits for it. */
  readonly tracker?: Pick<TemplateDesignTracker, 'begin'>;
  /** Render's `designTemplateCompositions` with the app's wiring; null when it can't run (no reel, no FFmpeg). */
  readonly design: (
    template: Template,
    projectId: ProjectId,
  ) => Promise<{
    readonly graphics: GraphicComponents;
    readonly outcomes: readonly TemplateDesignOutcome[];
  } | null>;
}

/** Whether a template wants its graphics designed: graphic overlays and no compositions yet. */
export const wantsDesign = (template: Template): boolean =>
  (template.graphics?.compositions?.length ?? 0) === 0 &&
  template.text.some((overlay) => isGraphicOverlay(overlay.design));

/** The template's graphic overlays (the ones its design is for). */
const graphicOverlayIds = (template: Template): string[] =>
  template.text.filter((overlay) => isGraphicOverlay(overlay.design)).map((overlay) => overlay.id);

/** FIX-GFXWAIT: what the design left: how many graphics passed and the overlays with none. */
function settledOf(template: Template, outcomes: readonly TemplateDesignOutcome[] | null): DesignSettled {
  const wanted = graphicOverlayIds(template);
  const designed = new Set<string>(
    (outcomes ?? []).flatMap((outcome) => (outcome.composition ? outcome.overlays : [])),
  );
  const reasons = new Map<string, string>();
  for (const outcome of outcomes ?? [])
    if (!outcome.composition)
      for (const overlayId of outcome.overlays)
        reasons.set(overlayId, (outcome.reason ?? 'no design passed its checks').slice(0, 300));
  const missing = wanted
    .filter((overlayId) => !designed.has(overlayId))
    .map((overlayId) => ({
      overlayId,
      reason:
        reasons.get(overlayId) ?? (outcomes ? 'no design passed its checks' : 'the design could not run'),
    }));
  return { designed: wanted.length - missing.length, total: wanted.length, missing };
}

/** A template whose graphics are set already: the overlays a use draws with one of its compositions are designed. */
function settledFromHead(template: Template): DesignSettled {
  const held = new Set((template.graphics?.compositions ?? []).map((composition) => composition.id));
  const drawn = new Set<string>(
    (template.graphics?.uses ?? []).flatMap((use) =>
      use.compositionId !== undefined && held.has(use.compositionId) ? [use.overlayId] : [],
    ),
  );
  const wanted = graphicOverlayIds(template);
  const missing = wanted
    .filter((overlayId) => !drawn.has(overlayId))
    .map((overlayId) => ({ overlayId, reason: 'no design passed its checks' }));
  return { designed: wanted.length - missing.length, total: wanted.length, missing };
}

/** Designs a template's graphics once and sets them on its head, and says how it went. Never throws. */
async function designOnce(
  designing: TemplateDesigning,
  projectId: ProjectId,
  template: Template,
): Promise<DesignSettled> {
  const templateId = template.id;
  // Its head again: another template's design ran before this one, and this one may have changed meanwhile.
  const head = await designing.templates.get({ templateId });
  if (head.ok && !wantsDesign(head.value.template)) return settledFromHead(head.value.template);
  const current = head.ok ? head.value.template : template;
  const done = await designing.design(current, projectId);
  if (!done) return settledOf(current, null);
  for (const outcome of done.outcomes)
    if (!outcome.composition)
      log(`${templateId} ${outcome.role}: no design (${outcome.reason ?? 'none passed'})`);
  const kept = done.graphics.compositions?.length ?? 0;
  log(`${templateId}: ${kept} of ${done.outcomes.length} graphics designed`);
  if (kept === 0) return settledOf(current, done.outcomes);
  const latest = await designing.templates.get({ templateId });
  if (!latest.ok) return settledOf(current, null);
  const set = await designing.bus.dispatch(
    TEMPLATE_COMMANDS.setGraphics,
    { projectId: null, templateId, baseVersion: latest.value.template.version, graphics: done.graphics },
    ORIGIN,
  );
  if (!set.ok) {
    log(`${templateId}: the designs were not set (${set.error.code})`);
    return settledOf(current, null);
  }
  return settledOf(current, done.outcomes);
}

/** The template a `template.create` made, when it wants its graphics designed; null otherwise. */
async function createdWantingDesign(
  designing: TemplateDesigning,
  projectId: ProjectId,
  commandId: string,
): Promise<Template | null> {
  // The listener has the command's id; the template's is in its audit entry.
  const recent = await designing.audit.listByProject(projectId, { limit: 20 });
  const entry = recent.ok ? recent.value.find((candidate) => candidate.id === commandId) : undefined;
  const templateId = (entry?.payload as { template?: { id?: TemplateId } } | undefined)?.template?.id;
  if (!templateId) return null;
  const head = await designing.templates.get({ templateId });
  return head.ok && wantsDesign(head.value.template) ? head.value.template : null;
}

/**
 * Designs each template made from a reel once its creation commits, one at a time, in the background. FIX-GFXWAIT:
 * each is recorded as being designed as soon as it is found, before it queues behind another's, and settled however
 * its design ends, so a make from it waits for exactly this design.
 */
export function startTemplateDesign(designing: TemplateDesigning): void {
  let queue = Promise.resolve();
  designing.bus.subscribe((change) => {
    if (change.kind !== 'executed' || change.name !== TEMPLATE_COMMANDS.create) return;
    const projectId = change.projectId;
    // The Designer works in a project's workspace: a template made outside one has none to design in.
    if (!projectId) return;
    const found = createdWantingDesign(designing, projectId, change.id).catch((cause: unknown) => {
      log(`template design not started (${String(cause).slice(0, 200)})`);
      return null;
    });
    void found.then((template) => {
      if (!template) return;
      const settle = designing.tracker?.begin(template.id, graphicOverlayIds(template)) ?? (() => {});
      queue = queue
        .then(async () => settle(await designOnce(designing, projectId, template)))
        .catch((cause: unknown) => {
          log(`template design stopped (${String(cause).slice(0, 200)})`);
          settle(settledOf(template, null));
        });
    });
  });
}

/**
 * The template design for this agent: the templates' store, the Designer, the workspace store and the render
 * process's worker, through main. Nothing where any is missing, and nothing in a recorded session.
 */
export function startTemplateDesignFor(container: Container, config: UtilityConfig): void {
  if (process.env[RECORDED_MODELS_ENV]) return;
  const needs = [
    TemplateStoreToken,
    TemplateMediaStoreToken,
    AgentMainServicesToken,
    WorkspaceStoreToken,
    AuditLogStoreToken,
    ModelClientToken,
  ] as const;
  if (needs.some((token) => !container.has(token))) return;
  const designer = templateDesignerOf(container);
  if (!designer) return;
  const templates = createTemplateService({
    store: container.resolve(TemplateStoreToken),
    clock: container.resolve(ClockToken),
    libraryMetadata: LIBRARY_STORE_KEEPS_METADATA,
  });
  const worker = renderWorkerOverRpc(() => container.resolve(AgentMainServicesToken)().render);
  startTemplateDesign({
    ...(container.has(TemplateDesignTrackerToken)
      ? { tracker: container.resolve(TemplateDesignTrackerToken) }
      : {}),
    bus: container.resolve(CommandBusToken),
    audit: container.resolve(AuditLogStoreToken),
    templates,
    design: async (template, projectId) => {
      const reel = await keptReel(container.resolve(TemplateMediaStoreToken), template.id);
      const binaries = await mediaBinaries(config).resolve();
      if (!reel || !binaries.ok) return null;
      return designTemplateCompositions(
        template,
        templateCompositionDeps({
          projectId,
          design: designer,
          store: container.resolve(WorkspaceStoreToken),
          worker,
          model: judgeModelOf(container),
          media: { binaries: binaries.value },
          reel,
          scratch: join(config.userData, 'scratch'),
        }),
      );
    },
  });
}
