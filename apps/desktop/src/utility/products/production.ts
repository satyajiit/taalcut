// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  CommandBusToken,
  CREATION_COMMANDS,
  CreationStoreToken,
  EventBusToken,
  defineCommand,
  err,
  newId,
  ok,
  PRODUCT_COMMANDS,
  ValidationError,
  idSchema,
  type AsyncResult,
  type Container,
  type CreationProject,
  type ProductCampaign,
  type ProductStore,
  type ProjectId,
  type TaalcutError,
} from '@taalcut/core';
import { productCampaignFailure, type ProductOperations } from '@taalcut/agent';
import { z } from 'zod';
import { creationCommandKit } from '../creation/command-kit';
import { SAVE_CREATION_STATE } from '../creation/commands';
import { authoredTimelines } from '../creation/publish';
import { ensureProductRenders } from './exports';

const APPROVE_PRODUCT_DRAFT = 'product.produceApprovedIdea';
const approvalSchema = z.object({
  projectId: idSchema<'Project'>(),
  campaignId: idSchema<'ProductCampaign'>(),
  revision: z.int().positive(),
});

export function productDraftCanProduce(project: CreationProject): boolean {
  return (
    project.status === 'awaiting-approval' &&
    !!project.draft?.visualPreviewAssetId &&
    !project.draft.questions.some((question) => question.required && !question.answer?.trim()) &&
    (project.budget.capMicros === null ||
      project.budget.spentMicros + project.budget.reservedMicros < project.budget.capMicros)
  );
}

/** A chosen idea is a durable intent; resume it after the command commits and after application restart. */
export function productProduction(container: Container, products: ProductStore, service: ProductOperations) {
  const bus = container.resolve(CommandBusToken);
  const creation = container.resolve(CreationStoreToken);
  const kit = creationCommandKit(container);
  let disposed = false;
  let draining: Promise<void> | undefined;
  const following = new Set<ProjectId>();
  const again = new Set<ProjectId>();
  const awaiting = new Set<ProjectId>();
  const active = new Set<ProjectId>();
  const approve = defineCommand({
    name: APPROVE_PRODUCT_DRAFT,
    payload: approvalSchema,
    sideEffect: 'write',
    internal: true,
    project: (input) => input.projectId,
    handle: kit.handle(async (input, context) => {
      const campaign = await products.getCampaign(input.campaignId);
      if (!campaign.ok) return campaign;
      const product = await products.get(campaign.value.productId);
      if (!product.ok) return product;
      const idea = await products.getIdea(campaign.value.ideaId);
      if (!idea.ok) return idea;
      const found = await creation.get(input.projectId);
      if (!found.ok) return found;
      if (
        product.value.archivedAt !== null ||
        campaign.value.projectId !== input.projectId ||
        campaign.value.status !== 'draft' ||
        idea.value.status !== 'chosen' ||
        found.value.revision !== input.revision ||
        !productDraftCanProduce(found.value)
      )
        return err(ValidationError({ field: 'product.approval' }));
      const project = {
        ...found.value,
        revision: found.value.revision + 1,
        approvedDraftRevision: found.value.draft!.revision,
        updatedAt: Date.now(),
      };
      const saved = await creation.save(project, found.value.revision, context);
      if (!saved.ok) return saved;
      kit.note(context, 'project', input.projectId);
      return ok({ result: project });
    }),
  });

  async function notice(
    campaign: ProductCampaign,
    kind: 'draft-ready' | 'failed' | 'approval-required',
    body: string,
  ): AsyncResult<void> {
    const product = await products.get(campaign.productId);
    if (!product.ok) return product;
    const saved = await products.appendNotification({
      id: newId<'ProductNotification'>(),
      productId: campaign.productId,
      campaignId: campaign.id,
      kind,
      title: product.value.name,
      body,
      createdAt: Date.now(),
      readAt: null,
    });
    if (saved.ok) announce(campaign);
    return saved;
  }
  function announce(campaign: ProductCampaign) {
    container.resolve(EventBusToken).emit('library.changed', {
      projectId: campaign.projectId,
      entity: 'project',
      change: 'updated',
      ids: [campaign.projectId],
    });
  }

  async function follow(projectId: ProjectId): AsyncResult<void> {
    const linked = await products.campaignForProject(projectId);
    if (!linked.ok || !linked.value) return linked.ok ? ok(undefined) : linked;
    const campaign = linked.value;
    if (campaign.retryAt && campaign.retryAt > Date.now()) return ok(undefined);
    if (campaign.status !== 'draft') {
      active.delete(projectId);
      return ok(undefined);
    }
    const parent = await products.get(campaign.productId);
    if (!parent.ok) return parent;
    if (parent.value.archivedAt !== null) return ok(undefined);
    const found = await creation.get(projectId);
    if (!found.ok) return found;
    const project = found.value;
    if (project.status === 'awaiting-approval') {
      if (!productDraftCanProduce(project)) {
        active.delete(projectId);
        if (awaiting.has(projectId)) return ok(undefined);
        awaiting.add(projectId);
        return notice(campaign, 'approval-required', project.brief.title);
      }
      const approved = await bus.dispatch(
        APPROVE_PRODUCT_DRAFT,
        { projectId, campaignId: campaign.id, revision: project.revision },
        { source: 'agent', actor: `product:${campaign.productId}` },
      );
      if (!approved.ok) return approved;
      const fresh = await creation.get(projectId);
      if (!fresh.ok) return fresh;
      const produced = await bus.dispatch(
        CREATION_COMMANDS.produce,
        { projectId, revision: fresh.value.revision },
        { source: 'agent', actor: `product:${campaign.productId}` },
      );
      return produced.ok ? ok(undefined) : produced;
    }
    if (project.status === 'failed' || project.status === 'cancelled') {
      active.delete(projectId);
      const saved = await products.saveCampaign(
        { ...campaign, status: 'failed', revision: campaign.revision + 1, updatedAt: Date.now() },
        campaign.revision,
      );
      return saved.ok ? notice(campaign, 'failed', project.brief.title) : saved;
    }
    if (project.status !== 'ready' || !project.timelineId) return ok(undefined);
    const timelines = await authoredTimelines(container, projectId);
    if (!timelines.ok) return timelines;
    if (!timelines.value.length) return err(ValidationError({ field: 'product.timeline' }));
    const rendered = await ensureProductRenders(container, products, campaign, timelines.value);
    if (!rendered.ok) return rendered;
    if (!rendered.value) return ok(undefined);
    const latest = await products.getCampaign(campaign.id);
    if (!latest.ok) return latest;
    if (latest.value.status !== 'draft') return ok(undefined);
    const saved = await products.saveCampaign(
      { ...latest.value, status: 'ready', revision: latest.value.revision + 1, updatedAt: Date.now() },
      latest.value.revision,
    );
    active.delete(projectId);
    void drain();
    return saved.ok ? notice(latest.value, 'draft-ready', project.brief.title) : saved;
  }

  async function recordFailure(campaign: ProductCampaign, error: TaalcutError) {
    const failed = productCampaignFailure(campaign, error, Date.now());
    const saved = await products.saveCampaign(failed, campaign.revision);
    if (saved.ok) {
      const idea = await products.getIdea(campaign.ideaId);
      await notice(failed, 'failed', idea.ok ? idea.value.title : '');
    }
  }
  function enqueue(projectId: ProjectId) {
    if (disposed) return;
    again.add(projectId);
    if (following.has(projectId)) return;
    following.add(projectId);
    void (async () => {
      while (again.delete(projectId) && !disposed) {
        const result = await follow(projectId);
        if (!result.ok) {
          active.delete(projectId);
          const campaign = await products.campaignForProject(projectId);
          if (campaign.ok && campaign.value?.status === 'draft') {
            await recordFailure(campaign.value, result.error);
          }
          void drain();
        }
      }
    })().finally(() => following.delete(projectId));
  }
  async function drain() {
    if (draining) return draining;
    draining = (async () => {
      let after: string | undefined;
      while (!disposed) {
        const pending = await products.pendingCampaigns({ ...(after ? { after } : {}), limit: 100 });
        if (!pending.ok || !pending.value.length) break;
        for (const campaign of pending.value) {
          if (campaign.retryAt && campaign.retryAt > Date.now()) continue;
          if (campaign.conversationId) {
            const existing = await creation.get(campaign.projectId);
            if (
              existing.ok &&
              (['researching', 'producing'].includes(existing.value.status) ||
                productDraftCanProduce(existing.value))
            )
              active.add(campaign.projectId);
          }
          if (!campaign.conversationId && active.size >= 2) continue;
          if (!campaign.conversationId) active.add(campaign.projectId);
          const resumed = await service.resumeCampaign(campaign.id);
          if (!resumed.ok) {
            active.delete(campaign.projectId);
            const current = await products.getCampaign(campaign.id);
            if (current.ok) await recordFailure(current.value, resumed.error);
          } else {
            announce(resumed.value);
            enqueue(campaign.projectId);
          }
        }
        after = pending.value.at(-1)!.id;
      }
    })().finally(() => {
      draining = undefined;
    });
    return draining;
  }
  const unsubscribe = bus.subscribe((change) => {
    if (change.kind === 'undone') return;
    if (change.name === PRODUCT_COMMANDS.choose) void drain();
    if (change.projectId && (change.name === SAVE_CREATION_STATE || change.name.startsWith('creation.')))
      enqueue(change.projectId);
  });
  const unrender = container
    .resolve(EventBusToken)
    .on('render.finished', ({ payload }) => enqueue(payload.projectId));
  return {
    commands: [approve],
    wake: drain,
    follow: enqueue,
    start: drain,
    dispose() {
      disposed = true;
      unsubscribe();
      unrender();
    },
  };
}
