// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ConflictError, err, newId, ok, type CreationProject, type CreationStore } from '@taalcut/core';
import { vi } from 'vitest';
import {
  createCreationDirector,
  type CreationDirectorDeps,
  type CreationModelRequest,
} from '../../src/creation';

export function creationFixture(
  options: { voice?: boolean; beats?: number; cap?: number; failPreview?: boolean } = {},
) {
  const projectId = newId<'Project'>();
  const assetId = newId<'Asset'>();
  const timelineId = newId<'Timeline'>();
  let project: CreationProject = {
    projectId,
    revision: 1,
    brief: {
      category: 'product-launch',
      title: 'Example launch',
      prompt: 'Show the product doing real work.',
      audience: 'Creators',
      callToAction: 'Try Example',
      formats: ['16:9', '9:16'],
      duration: { value: 300, rate: { num: 30, den: 1 } },
      voice: {
        mode: options.voice ? 'connected' : 'none',
        voiceId: 'test-voice',
        assetId: null,
        language: 'en',
      },
    },
    sources: [
      {
        id: newId<'CreationSource'>(),
        kind: 'url',
        label: 'Product',
        url: 'https://example.com',
        status: 'pending',
        assetIds: [],
        evidence: [],
      },
    ],
    draft: null,
    approvedDraftRevision: null,
    status: 'draft',
    tasks: [],
    timelineId: null,
    error: null,
    budget: { capMicros: options.cap ?? 1_000_000, spentMicros: 0, reservedMicros: 0 },
    createdAt: 1,
    updatedAt: 1,
  };
  const store: CreationStore = {
    get: async () => ok(structuredClone(project)),
    list: async () => ok([structuredClone(project)]),
    save: async (next, expected) => {
      if (expected !== project.revision) return err(ConflictError({ entity: 'creation', id: projectId }));
      project = structuredClone(next);
      return ok(undefined);
    },
  };
  const calls: CreationModelRequest[] = [];
  let concurrent = 0;
  let peak = 0;
  const deps: CreationDirectorDeps = {
    store,
    sources: {
      inspect: vi.fn(async (source) =>
        ok({
          ...source,
          status: 'ready' as const,
          content: 'Example helps creators export video.',
          evidence: [{ sourceId: source.id, locator: 'https://example.com', summary: 'Export screen' }],
        }),
      ),
    },
    model: {
      estimate: () => 100,
      complete: vi.fn(async (request) => {
        calls.push(request);
        concurrent++;
        peak = Math.max(peak, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 1));
        concurrent--;
        let output: unknown;
        if (request.role === 'researcher') output = { summary: 'Verified export feature.', questions: [] };
        else if (request.role === 'writer')
          output = {
            title: 'One idea to a film',
            visualDirection: 'Ink and orange, continuous objects.',
            beats: Array.from({ length: options.beats ?? 4 }, (_, i) => ({
              id: `beat-${i}`,
              duration: { value: 90, rate: { num: 30, den: 1 } },
              narration: 'Make your next film.',
              screenText: 'Make a film',
              visual: 'Actual export button',
              transition: 'Button expands into next surface',
            })),
            questions: [],
          };
        else if (request.role === 'director') {
          const input = JSON.parse(request.prompt) as { draft: { beats: { id: string }[] } };
          const anchor = { objectId: 'product', x: 0.5, y: 0.5, scale: 1 };
          output = {
            palette: { background: '#101014', foreground: '#ffffff', accent: '#ff6600' },
            fontFamily: 'Noto Sans',
            ease: 'power3.inOut',
            stage: 'One continuous product surface',
            carries: input.draft.beats.map((beat) => ({ beatId: beat.id, enter: anchor, exit: anchor })),
          };
        } else if (request.role === 'designer') {
          const input = JSON.parse(request.prompt) as { beat?: { id: string } };
          const prefix = input.beat?.id ?? 'master';
          output = {
            html: input.beat
              ? `<div id="${prefix}-title" data-hf-id="${prefix}-title" class="clip" data-start="0" data-duration="2">Make a film</div>`
              : '<div id="master-cursor" data-hf-id="master-cursor">↖</div><div id="master-logo" data-hf-id="master-logo">Example</div>',
            css: 'div { color: orange; }',
            animation: `tl.to('#${prefix}-${input.beat ? 'title' : 'cursor'}', {opacity: 1, duration: 0.4}, 0);`,
          };
        } else output = { passed: true, notes: [] };
        return ok({ text: JSON.stringify(output), usageMicros: 50, tokens: 20 });
      }),
    },
    preview: vi.fn(async () =>
      options.failPreview ? err(ConflictError({ entity: 'preview', id: 'test' })) : ok(assetId),
    ),
    estimateVoice: () => 100,
    voice: vi.fn(async () =>
      ok({ usageMicros: 50, assetIds: [assetId], lines: [{ beatId: 'beat-0', assetId, durationMs: 900 }] }),
    ),
    publish: vi.fn(async () => ok(timelineId)),
    review: vi.fn(async () => ok({ passed: true, notes: [] })),
    finalize: vi.fn(async () => ok(undefined)),
    now: () => 10,
  };
  return {
    projectId,
    assetId,
    timelineId,
    store,
    deps,
    calls,
    get: () => project,
    set: (next: CreationProject) => {
      project = next;
    },
    approve: () => {
      project = {
        ...project,
        approvedDraftRevision: project.draft!.revision,
        revision: project.revision + 1,
      };
    },
    director: () => createCreationDirector(deps),
    peak: () => peak,
  };
}
