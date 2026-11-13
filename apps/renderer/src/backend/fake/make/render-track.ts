// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fake's stored renders, and the renders the scripted chat flow announces in its renderProgress cards
 * (chat/fake-flow.ts): kept as the card says, so the card, its live data and Exports agree. The flow drives
 * them; no tick moves them on.
 */
import type { CardOf, ProjectId, QaReport, RenderId, RenderSnapshot, TaalcutError } from '@taalcut/core';
import { framesOf } from './build';
import type { FakeTimelines } from './fake-timelines';
import { bytesOf, qaReport, WARNED } from './render-data';
import { presetName, renderSnapshot } from './render-snapshot';

export interface StoredRender {
  snapshot: RenderSnapshot;
  report: QaReport | null;
  /** Found when it was queued: the render stops at preflight with it, as the real export does. */
  failure?: TaalcutError;
}

export interface TrackedRenders {
  find(renderId: RenderId): StoredRender | undefined;
  patch(stored: StoredRender, next: Partial<RenderSnapshot>): void;
  /** Keeps a new render and announces it. */
  add(stored: StoredRender): void;
  readonly timelines: FakeTimelines;
  readonly projectName: (projectId: ProjectId) => string;
}

export function trackFlowRender(card: CardOf<'renderProgress'>, renders: TrackedRenders): void {
  const existing = renders.find(card.renderId);
  const ready = card.status === 'ready' || card.status === 'needsAttention';
  if (existing) {
    if (ready && card.qa && !existing.report)
      existing.report = qaReport(card.renderId, card.presetId, WARNED, Date.now());
    renders.patch(existing, {
      status: card.status,
      progress: card.progress,
      qa: card.qa,
      ...(ready && existing.snapshot.finishedAt === null ? { finishedAt: Date.now() } : {}),
    });
    return;
  }
  const timeline = renders.timelines
    .listByProject(card.projectId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const doc = timeline ? renders.timelines.get(timeline.id) : undefined;
  if (!doc) return;
  const snapshot = renderSnapshot(doc, {
    id: card.renderId,
    projectId: card.projectId,
    presetId: card.presetId,
    status: card.status,
    progress: card.progress,
    name: `${renders.projectName(card.projectId)} – ${presetName(card.presetId)}`,
    bytes: ready ? bytesOf(card.presetId, framesOf(doc) / 30) : null,
    captions: { burnIn: doc.captions?.enabled ?? false, sidecars: [] },
    qa: card.qa,
    notify: card.notify,
    finishedAt: ready ? Date.now() : null,
  });
  renders.add({
    snapshot,
    report: ready && card.qa ? qaReport(card.renderId, card.presetId, WARNED, Date.now()) : null,
  });
}
