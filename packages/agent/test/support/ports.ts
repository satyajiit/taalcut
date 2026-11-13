// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Test helpers for the Phase 2 services: a MessageChannel pair to serve a
 * router on (closed after each test), and a ProjectBudgetStore fake that
 * honours core's port (the library lane implements the real one).
 */
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { err, NotFoundError, ok, type Money, type ProjectBudgetStore, type ProjectId } from '@taalcut/core';
import { afterEach } from 'vitest';

const open: MessagePort[] = [];

afterEach(() => {
  for (const port of open.splice(0)) port.close();
});

export function channel(): { port1: MessagePort; port2: MessagePort } {
  const { port1, port2 } = new MessageChannel();
  open.push(port1, port2);
  return { port1, port2 };
}

export const usd = (dollars: number): Money => ({ currency: 'USD', micros: Math.round(dollars * 1_000_000) });

/** Caps and spend per project; an unknown project is core.not_found, as the library's store answers. */
export function fakeBudgetStore(
  projects: Record<string, { cap: Money | null; spent: Money }>,
): ProjectBudgetStore & { readonly writes: { projectId: string; cap: Money | null }[] } {
  const writes: { projectId: string; cap: Money | null }[] = [];
  return {
    writes,
    async get(projectId: ProjectId) {
      const project = projects[projectId];
      if (!project) return err(NotFoundError({ entity: 'project', id: projectId }));
      return ok({ projectId, cap: project.cap, spent: project.spent });
    },
    async setCap(projectId: ProjectId, cap: Money | null) {
      const project = projects[projectId];
      if (!project) return err(NotFoundError({ entity: 'project', id: projectId }));
      project.cap = cap;
      writes.push({ projectId, cap });
      return ok(cap);
    },
  };
}
