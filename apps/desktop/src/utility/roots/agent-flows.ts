// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent's Phase 2 dependencies in the agent process (packages/agent
 * SPEC, sections 11 to 16): the skill modules the domain packages declare,
 * composed into the skill registry; the project cap (the library's budget
 * store); prices for estimates; telemetry; a project for a chat's first
 * flow; and the stored versions the flow watcher compares.
 *
 * A skill module whose tools aren't registered in this process yet is left
 * out with a warning instead of failing the app, and until a whole flow can
 * run there are no skills at all (the opening card says why). Local only is cached here for the ModelClient, which asks for it
 * synchronously before every cloud call.
 */
import {
  ClockToken,
  CommandBusToken,
  ConversationStoreToken,
  createToken,
  EventBusToken,
  ExperimentSandboxToken,
  LOCAL_ONLY_SETTING,
  noTelemetry,
  ok,
  OPENING_PATHS,
  PROJECT_COMMANDS,
  ProjectBudgetStoreToken,
  RenderStoreToken,
  SettingsStoreToken,
  TelemetryToken,
  TemplateStoreToken,
  TimelineStoreToken,
  type AsyncResult,
  type Container,
  type ConversationId,
  type ProjectId,
  type Result,
  type SettingsStore,
  type SkillModule,
} from '@taalcut/core';
import {
  agentSkillModule,
  createSkillRegistry,
  emptySkillRegistry,
  flowProblems,
  SkillModulesToken,
  type AgentDeps,
  type ChatServiceDeps,
  type FlowProjects,
  type RefVersions,
  type SkillRegistry,
} from '@taalcut/agent';
import { createPriceLookup } from '@taalcut/models';
import { createTemplateService, createTemplateSkills } from '@taalcut/templates';
import {
  ModelProfilesToken,
  ModelRuntimeToken,
  PlanBillingToken,
  ToolRegistryToken,
} from '../../shared/tokens';
import { audioAgentSkills } from './agent-audio-skills';
import { flowExportFacts } from './agent-export-facts';
import { agentGapsOptions } from './agent-gaps';
import { renderAgentSkills } from './agent-render';
import { BreakdownJobLogToken } from './agent-templates';
import { LocalOnlyFlagToken, type LocalOnlyFlag } from './agent-local-only-flag';
import { timelineAgentSkills } from './agent-timeline';
import { syncConversationProjectName } from './project-naming';

export const SkillRegistryToken = createToken<SkillRegistry>('agent.skillRegistry');

// The Local only flag's token lives in agent-local-only-flag.ts, so agent-workspace-tools reads it without a cycle.
export { LocalOnlyFlagToken, type LocalOnlyFlag } from './agent-local-only-flag';

/** Refuses cloud calls until the first read says otherwise: nothing leaves before the setting is known. */
export function createLocalOnlyFlag(settings: Pick<SettingsStore, 'get'>): LocalOnlyFlag {
  let value: boolean | undefined;
  return {
    get: () => value ?? true,
    async refresh() {
      const read = await settings.get(LOCAL_ONLY_SETTING);
      if (read.ok) value = read.value;
      else {
        console.warn(`[agent] Local only not read: ${read.error.code}`);
        value ??= LOCAL_ONLY_SETTING.defaultValue;
      }
    },
  };
}

/**
 * The domain skill modules this process can build, each over its package's stores: the library path's
 * brief (agent), the Analyst (templates), the Librarian and the Editor (timeline), the Reviewer (render).
 */
function domainSkillModules(container: Container): SkillModule[] {
  // The agent's own: the brief, and the gaps step once timelines are stored here (agent-gaps.ts).
  const modules: SkillModule[] = [
    agentSkillModule(agentGapsOptions(container, () => container.resolve(LocalOnlyFlagToken).get())),
  ];
  if (container.has(TemplateStoreToken) && container.has(ExperimentSandboxToken)) {
    const store = container.resolve(TemplateStoreToken);
    modules.push(
      createTemplateSkills({
        service: createTemplateService({ store, clock: container.resolve(ClockToken) }),
        sandbox: container.resolve(ExperimentSandboxToken),
        ...(container.has(BreakdownJobLogToken)
          ? { breakdownJobs: container.resolve(BreakdownJobLogToken) }
          : {}),
      }),
    );
  }
  if (container.has(TimelineStoreToken) && container.has(TemplateStoreToken))
    modules.push(timelineAgentSkills(container));
  if (container.has(RenderStoreToken)) modules.push(renderAgentSkills(container));
  // The Voice director, where the library keeps generated files (agent-audio-skills.ts).
  modules.push(...audioAgentSkills(container));
  return modules;
}

/**
 * Only the modules whose tools all resolve; two modules claiming one skill id is a wiring bug and throws.
 * Until a whole flow can run, no skills at all: the agent's requests stay Phase 1's exactly (the gate's
 * recorded session matches on the tools offered), and a skill outside a flow has nothing to hand off to.
 */
function composeSkills(modules: readonly SkillModule[], tools: Parameters<typeof createSkillRegistry>[1]) {
  const usable = modules.filter((module) => {
    const alone = createSkillRegistry([module], tools);
    if (!alone.ok)
      console.warn(`[agent] skills '${module.id}' not composed yet: ${alone.error.detail ?? ''}`);
    return alone.ok;
  });
  const registry = createSkillRegistry(usable, tools);
  if (!registry.ok)
    throw new Error(`Skill modules don't compose: ${registry.error.detail ?? registry.error.code}`);
  const hasTool = (name: string) => tools.describe(name) !== undefined;
  if (OPENING_PATHS.some((path) => flowProblems(path, registry.value, hasTool).length === 0))
    return registry.value;
  console.warn('[agent] no flow can run yet (its skills or render.export are missing): skills wait');
  return emptySkillRegistry();
}

export function registerAgentFlows(container: Container): void {
  container.factory(SkillModulesToken, () => domainSkillModules(container));
  container.factory(SkillRegistryToken, ({ modules, tools }) => composeSkills(modules, tools), {
    deps: { modules: SkillModulesToken, tools: ToolRegistryToken },
  });
  container.factory(LocalOnlyFlagToken, ({ settings }) => createLocalOnlyFlag(settings), {
    deps: { settings: SettingsStoreToken },
  });
}

/** A ref whose entity is gone has no version (undefined); other errors stay errors. */
const missing = <T>(read: Result<T>): Result<T | undefined> =>
  read.ok || read.error.code !== 'core.not_found' ? read : ok(undefined);

/** A template's head, a timeline's revision, a render's QA round: what a step's card shows moved. */
function storeRefs(container: Container): RefVersions {
  return {
    async version(ref): AsyncResult<number | undefined> {
      if (ref.entity === 'template' && container.has(TemplateStoreToken))
        return missing(await container.resolve(TemplateStoreToken).latestVersion(ref.id as never));
      if (ref.entity === 'timeline' && container.has(TimelineStoreToken)) {
        const stored = await container.resolve(TimelineStoreToken).get(ref.id as never);
        return missing(stored.ok ? ok(stored.value.summary.revision) : stored);
      }
      if (ref.entity === 'render' && container.has(RenderStoreToken)) {
        const render = await container.resolve(RenderStoreToken).get(ref.id as never);
        return missing(render.ok ? ok(render.value.qaReport?.round ?? 1) : render);
      }
      return ok(undefined);
    },
  };
}

/**
 * A chat with no project gets one when its first flow starts (project.create,
 * which sets the default cap), and the chat moves into it
 * (ConversationStore.setProject), so the sidebar lists it there. The chat
 * service passes a linked conversation's project, and later runs reuse the
 * conversation's latest flow's.
 */
function flowProjects(container: Container): FlowProjects {
  return {
    async forConversation(conversationId, { name }) {
      const created = await container
        .resolve(CommandBusToken)
        .dispatch(PROJECT_COMMANDS.create, { name }, { source: 'agent', actor: 'agent:flow' });
      if (!created.ok) return created;
      const projectId = (created.value.result as { projectId: ProjectId }).projectId;
      if (container.has(ConversationStoreToken)) {
        const id = conversationId as ConversationId;
        const linked = await container.resolve(ConversationStoreToken).setProject(id, projectId);
        if (!linked.ok) return linked;
        container
          .resolve(EventBusToken)
          .emit('library.changed', { projectId, entity: 'conversation', change: 'updated', ids: [id] });
        await syncConversationProjectName(container, id);
      }
      return ok(projectId);
    },
  };
}

/**
 * A chat the editor's dock started for a project nobody wrote in yet is in no project: its first message's
 * clip, item or range chips (or the editor it was sent from) name one of the project's timelines, so the chat moves into that timeline's project
 * (ConversationStore.setProject) before the run starts, and the project's page finds it
 * (`ProjectSummary.conversationId`).
 */
export function chatProjectLink(container: Container): NonNullable<ChatServiceDeps['linkProject']> {
  return async (conversationId, selections, onScreen) => {
    if (!container.has(TimelineStoreToken) || !container.has(ConversationStoreToken)) return null;
    const timelineId =
      onScreen ??
      selections.flatMap((chip) =>
        chip.kind === 'clip' || chip.kind === 'item' || chip.kind === 'range' ? [chip.timelineId] : [],
      )[0];
    if (!timelineId) return null;
    const stored = await container.resolve(TimelineStoreToken).get(timelineId);
    if (!stored.ok) return null;
    const { projectId } = stored.value.summary;
    const linked = await container.resolve(ConversationStoreToken).setProject(conversationId, projectId);
    if (!linked.ok) return null;
    container.resolve(EventBusToken).emit('library.changed', {
      projectId,
      entity: 'conversation',
      change: 'updated',
      ids: [conversationId],
    });
    return projectId;
  };
}

/** What createAgent gets for Phase 2 (resolved when the agent is). */
export function agentFlowDeps(container: Container): Partial<AgentDeps> {
  const exports = flowExportFacts(container);
  return {
    skills: container.resolve(SkillRegistryToken),
    ...projectCapDeps(container),
    telemetry: container.has(TelemetryToken) ? container.resolve(TelemetryToken) : noTelemetry,
    projects: flowProjects(container),
    refs: storeRefs(container),
    ...(exports ? { exports } : {}),
    ...(container.has(TemplateStoreToken) ? { templateSlots: templateSlots(container) } : {}),
  };
}

/** AGT1: a template's slot count, for the cast board's question in a make run that has no Analyst step. */
function templateSlots(container: Container): NonNullable<AgentDeps['templateSlots']> {
  return async (templateId) => {
    const stored = await container.resolve(TemplateStoreToken).get(templateId as never);
    return missing(stored.ok ? ok(stored.value.summary.slotCount) : stored);
  };
}

/** Prices and project budgets: what a model turn, and the chat-title call, check against the cap (P2-X1). */
export function projectCapDeps(container: Container): Pick<AgentDeps, 'prices' | 'budgets'> {
  const profiles = container.resolve(ModelProfilesToken);
  return {
    ...(container.has(ProjectBudgetStoreToken)
      ? { budgets: container.resolve(ProjectBudgetStoreToken) }
      : {}),
    prices: createPriceLookup({
      selector: profiles,
      runtime: container.resolve(ModelRuntimeToken),
      // A plan the person signed in with (ChatGPT) has no per-token price and nothing left of a cap (UX3-AGT).
      ...(container.has(PlanBillingToken)
        ? { planBilled: container.resolve(PlanBillingToken).isPlanBilled }
        : {}),
    }),
  };
}
