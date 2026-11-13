// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Phase 3 render commands on the real bus: Content Credentials are the person's choice alone (P3-V7), the
 * Style's bumpers are a saved export option (P3-V10), and a stored Phase 2 request reads with today's
 * defaults (contract review P3-1, findings 11 and 13).
 */
import { describe, expect, it } from 'vitest';
import {
  createCommandBus,
  createManualClock,
  createMemoryAuditLogStore,
  createMemorySettingsStore,
  exportRequestSchema,
  newId,
  unwrap,
  type ProjectId,
} from '@taalcut/core';
import { createRenderCommands } from '../../src/commands/render-commands';
import { exportRequestKey } from '../../src/commands/request';
import { exportSettingFor } from '../../src/settings';
import { storedRequest } from '../../src/store/stored-request';
import { memoryRenderStore } from '../support/render-store';
import { makeTimeline } from '../support/timeline';
import { AGENT, memoryTimelines, recordingEnqueuer, UI } from './support';

function setup() {
  const timeline = makeTimeline({ items: [{ frames: 90 }] });
  const settings = createMemorySettingsStore();
  const clock = createManualClock(1_000);
  const store = memoryRenderStore();
  const commands = createRenderCommands({
    store,
    enqueuer: recordingEnqueuer(),
    timelines: memoryTimelines(timeline),
    settings,
    clock,
  });
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock });
  bus.register(...commands.all);
  return { bus, commands, settings, store, timeline, projectId: timeline.projectId };
}

describe('render.setContentCredentials', () => {
  it('is off by default, set by a person, undone exactly', async () => {
    const { bus, commands, settings, projectId } = setup();
    const setting = exportSettingFor(projectId);
    expect(unwrap(await settings.get(setting)).contentCredentials).toEqual({ add: false });
    unwrap(await bus.dispatch(commands.setContentCredentials, { projectId, add: true }, UI));
    expect(unwrap(await settings.get(setting)).contentCredentials).toEqual({ add: true });
    unwrap(await bus.undo(projectId, UI));
    expect(unwrap(await settings.get(setting)).contentCredentials).toEqual({ add: false });
  });

  it('is refused from the agent: the agent never turns credentials on', async () => {
    const { bus, commands, settings, projectId } = setup();
    const refused = await bus.dispatch(commands.setContentCredentials, { projectId, add: true }, AGENT);
    expect(refused.ok).toBe(false);
    expect(unwrap(await settings.get(exportSettingFor(projectId))).contentCredentials.add).toBe(false);
  });
});

describe('render.setExportPreset', () => {
  it('saves includeBumpers and keeps the credentials choice; undo restores both', async () => {
    const { bus, commands, settings, projectId } = setup();
    const setting = exportSettingFor(projectId);
    unwrap(await bus.dispatch(commands.setContentCredentials, { projectId, add: true }, UI));
    unwrap(
      await bus.dispatch(
        commands.setExportPreset,
        { projectId, presetId: 'landscape', includeBumpers: false },
        UI,
      ),
    );
    expect(unwrap(await settings.get(setting))).toMatchObject({
      presetId: 'landscape',
      includeBumpers: false,
      contentCredentials: { add: true },
    });
    unwrap(await bus.undo(projectId, UI));
    expect(unwrap(await settings.get(setting))).toMatchObject({
      presetId: 'device',
      includeBumpers: true,
      contentCredentials: { add: true },
    });
  });
});

describe('stored requests and the dedupe key', () => {
  it('reads a Phase 2 request with the Phase 3 defaults applied', () => {
    const projectId = newId<'Project'>() as ProjectId;
    const phase2 = {
      projectId,
      timelineId: newId<'Timeline'>(),
      timelineRevision: 3,
      presetId: 'shorts',
      captions: { burnIn: true, sidecars: [] },
      notify: false,
    };
    // A row written before Phase 3, as the store hands it back (no parse on read).
    const record = { id: newId<'Render'>(), request: phase2 };
    const request = unwrap(storedRequest(record));
    expect(request.includeBumpers).toBe(true);
    expect(request.contentCredentials).toEqual({ add: false });
  });

  it('keeps a Phase 2 key, and separates credentials, bumpers and batches', () => {
    const base = exportRequestSchema.parse({
      projectId: newId<'Project'>(),
      timelineId: newId<'Timeline'>(),
      timelineRevision: 2,
      presetId: 'device',
      captions: { burnIn: true, sidecars: [] },
    });
    const key = exportRequestKey(base);
    expect(exportRequestKey({ ...base, notify: true })).toBe(key);
    expect(exportRequestKey({ ...base, contentCredentials: { add: true } })).not.toBe(key);
    expect(exportRequestKey({ ...base, includeBumpers: false })).not.toBe(key);
    expect(exportRequestKey({ ...base, batchId: newId<'RenderBatch'>() })).not.toBe(key);
  });
});
