// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  CancelledError,
  CommandBusToken,
  ConversationStoreToken,
  CREATION_COMMANDS,
  CreationStoreToken,
  err,
  ok,
  wrapUntrusted,
  type Container,
  type ConversationId,
  type CreationBrief,
  type CreationSource,
  type ProductStore,
} from '@taalcut/core';
import type { ProductCreationInput, ProductServiceDeps } from '@taalcut/agent';
import { creationCommandStore } from '../creation/commands';

export function productCreationBrief({ product, idea }: ProductCreationInput): CreationBrief {
  return {
    category: 'custom',
    title: idea.title,
    prompt: [
      `Create a recurring product feature video for ${product.name}. Focus on ${idea.featureKey}: ${idea.angle}.`,
      `Hook: ${idea.hook}. Use precise product claims, clear demonstrations, strong motion design and readable pacing.`,
      `Content preferences: ${product.preferences.instructions}. Tone: ${product.preferences.tone}.`,
      `Language: ${product.preferences.language}. Preferred output: 4K at 60 fps.`,
      wrapUntrusted(
        idea.evidence.map((e) => `[${e.locator}; digest ${e.digest}] ${e.excerpt}`).join('\n'),
        'product-evidence',
      ),
    ]
      .join('\n')
      .slice(0, 12000),
    audience: product.preferences.audience,
    callToAction: product.preferences.callToAction,
    formats: product.preferences.formats,
    duration: product.preferences.duration,
    voice: product.preferences.voice,
  };
}

/** Ready snapshots prevent the creation researcher from executing attached repositories without opt-in. */
export function productCreationSources(input: ProductCreationInput): CreationSource[] {
  const cited = new Set(input.idea.evidence.map((evidence) => evidence.sourceId));
  return [...input.product.sources]
    .sort((a, b) => Number(cited.has(b.id)) - Number(cited.has(a.id)))
    .slice(0, 50)
    .map((source) => {
      const docs = input.knowledge.filter((doc) => doc.sourceId === source.id);
      const { purpose: _purpose, liveCapture, ...original } = source;
      return {
        ...original,
        status: liveCapture ? 'pending' : 'ready',
        content: docs
          .map((doc) => `[${doc.locator}; digest ${doc.digest}]\n${doc.text}`)
          .join('\n\n')
          .slice(0, 100000),
        evidence: docs.slice(0, 100).map((doc) => ({
          sourceId: source.id,
          locator: doc.locator.slice(0, 2000),
          summary: doc.text.slice(0, 4000),
        })),
        assetIds: source.assetId ? [source.assetId] : [],
      };
    });
}

export function productCreation(
  container: Container,
  _products: ProductStore,
): ProductServiceDeps['creation'] {
  const bus = container.resolve(CommandBusToken);
  const raw = container.resolve(CreationStoreToken);
  const store = creationCommandStore(container, raw);
  return {
    async create(input, signal) {
      if (signal.aborted) return err(CancelledError());
      const projectId = input.campaign.projectId;
      let project = await store.get(projectId);
      if (!project.ok) {
        if (project.error.code !== 'core.not_found') return project;
        const made = await bus.dispatch(
          CREATION_COMMANDS.create,
          { projectId, brief: productCreationBrief(input) },
          { source: 'agent', actor: `product:${input.product.id}` },
        );
        if (!made.ok) return made;
        project = await store.get(projectId);
        if (!project.ok) return project;
      }
      if (project.value.status === 'draft' && !project.value.draft && project.value.sources.length === 0) {
        const cap = input.product.preferences.budgetCapMicros;
        const inherited = project.value.budget.capMicros;
        const saved = await store.save(
          {
            ...project.value,
            revision: project.value.revision + 1,
            sources: productCreationSources(input),
            budget: {
              ...project.value.budget,
              capMicros: cap === null ? inherited : inherited === null ? cap : Math.min(cap, inherited),
            },
            updatedAt: Date.now(),
          },
          project.value.revision,
        );
        if (!saved.ok) return saved;
        project = await store.get(projectId);
        if (!project.ok) return project;
      }
      const conversations = container.resolve(ConversationStoreToken);
      // Stable identity survives a crash between conversation creation and the campaign checkpoint.
      const conversationId = input.campaign.conversationId ?? (input.campaign.id as string as ConversationId);
      const conversation = await conversations.get(conversationId);
      if (!conversation.ok) {
        if (conversation.error.code !== 'core.not_found') return conversation;
        const made = await conversations.create({ id: conversationId, projectId, title: input.idea.title });
        if (!made.ok) return made;
      } else if (conversation.value.conversation.projectId !== projectId) {
        const linked = await conversations.setProject(conversationId, projectId);
        if (!linked.ok) return linked;
      }
      if (project.value.status === 'draft' && !project.value.draft) {
        const started = await bus.dispatch(
          CREATION_COMMANDS.research,
          { projectId, revision: project.value.revision },
          { source: 'agent', actor: `product:${input.product.id}` },
        );
        if (!started.ok) return started;
      }
      return ok({ projectId, conversationId });
    },
  };
}
export const createProductCreation = productCreation;
