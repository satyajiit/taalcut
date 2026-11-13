// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Shared fakes for the hub client tests. Nothing here talks to a network. */
import {
  FrameRates,
  hubIndexEntrySchema,
  hubIndexSchema,
  newId,
  ok,
  RationalTime,
  type HubIndex,
  type HubIndexEntry,
  type HubShareForm,
} from '@taalcut/core';
import { sha256Hex } from '../../src/store/change-key';
import type { HubIds } from '../../src/hub/from-hub';
import type { HubTransport } from '../../src/hub/hub-transport';
import { toHubTemplate, type HubTemplateMeta } from '../../src/hub/to-hub';
import { referenceTemplate } from '../helpers/fixtures';

/** Fresh ids for every template, slot and overlay a hub document becomes. */
export function hubIds(): HubIds {
  return { template: () => newId(), slot: () => newId(), overlay: () => newId() };
}

export const FORM: HubShareForm = {
  name: 'Day one',
  description: 'Four cuts on the beat.',
  handle: 'goa.creator',
  tags: ['travel'],
  language: 'en',
  includeStyle: false,
};

export function meta(patch: Partial<HubTemplateMeta> = {}): HubTemplateMeta {
  return {
    name: 'Library name',
    hubId: newId<'HubTemplate'>(),
    version: 1,
    provenance: null,
    ...patch,
  };
}

/** A hub document built from the reference template, plus the bytes a fork would hash. */
export function sharedDocument(patch: Partial<HubTemplateMeta> = {}) {
  const template = referenceTemplate();
  const card = meta(patch);
  const built = toHubTemplate(template, card, FORM, null);
  if (!built.ok) throw new Error(`${built.error.code} ${built.error.detail ?? ''}`);
  const text = JSON.stringify(built.value);
  return { template, meta: card, doc: built.value, text, sha256: sha256Hex(text) };
}

export function indexEntry(patch: Omit<Partial<HubIndexEntry>, 'id'> & { id?: string } = {}): HubIndexEntry {
  const duration = RationalTime.of(120, FrameRates.fps30);
  return hubIndexEntrySchema.parse({
    id: patch.id ?? newId<'HubTemplate'>(),
    version: 1,
    name: 'Day one',
    description: 'A quiet reel',
    handle: 'goa.creator',
    language: 'en',
    tags: ['travel'],
    formatId: 'vlog',
    trendFreshness: '2026-10-01',
    forkedFrom: null,
    duration,
    slotCount: 4,
    bpm: 120,
    slotStrip: [30, 15, 45, 30],
    sha256: 'a'.repeat(64),
    createdAt: 10,
    updatedAt: 20,
    ...patch,
  });
}

export function indexOf(templates: readonly HubIndexEntry[]): HubIndex {
  return hubIndexSchema.parse({ formatVersion: 0, generatedAt: 1, templates });
}

/** A transport whose methods are replaced per test. Defaults succeed with empty bodies. */
export function fakeTransport(): HubTransport & { readonly calls: string[] } {
  const calls: string[] = [];
  const note = (name: string) => calls.push(name);
  return {
    calls,
    async index() {
      note('index');
      return ok({ status: 200 as const, body: indexOf([]), etag: null });
    },
    async template() {
      note('template');
      return ok({ body: {}, sha256: 'a'.repeat(64) });
    },
    async ratings() {
      note('ratings');
      return ok({ generatedAt: 1, ratings: {} });
    },
    async submit() {
      note('submit');
      return ok({
        submissionId: newId<'HubSubmission'>(),
        hubId: newId<'HubTemplate'>(),
        version: 1,
        state: 'open' as const,
        pullRequest: 1,
      });
    },
    async submission() {
      note('submission');
      return ok({ state: 'open' as const });
    },
    async rate() {
      note('rate');
      return ok({ count: 1, mean: 5 });
    },
    async withdrawRating() {
      note('withdrawRating');
      return ok({ count: 0, mean: 0 });
    },
    async report() {
      note('report');
      return ok({ issue: 1 });
    },
  };
}
