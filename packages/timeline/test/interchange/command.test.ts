// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V5 `timeline.exportInterchange` on core's bus: resolves the originals, writes through the ExportFileSink,
 * names the file and lists the warnings, refuses a stale revision, changes nothing (nothing to undo), and fails
 * plainly (writing nothing) when a writer's file wouldn't read back to the timeline's cuts.
 */
import {
  defineError,
  err,
  FrameRates,
  ok,
  type AssetId,
  type ExportFileSink,
  type InterchangeMedia,
  type ProjectId,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { EXPORTERS } from '../../src/interchange/catalog';
import { defineExporter } from '../../src/interchange/exporter';
import { createExporterRegistry } from '../../src/interchange/registry';
import { commandWorld } from '../fixtures/command-world';
import { originals, thirtyClipTimeline } from '../fixtures/interchange';

const DiskFull = defineError('test.disk_full');

function sink(): ExportFileSink & { files: { projectId: ProjectId; name: string; text: string }[] } {
  const files: { projectId: ProjectId; name: string; text: string }[] = [];
  return {
    files,
    async write(input) {
      const name = `${input.baseName}${input.extension}`;
      files.push({ projectId: input.projectId, name, text: input.text });
      return ok({ fileName: name });
    },
  };
}

function setup(registry = createExporterRegistry(EXPORTERS)) {
  const timeline = thirtyClipTimeline(FrameRates.fps30);
  const media = originals(timeline);
  const files = sink();
  const asked: AssetId[][] = [];
  const world = commandWorld({
    interchange: {
      exporters: registry,
      files,
      media: {
        async resolve(ids) {
          asked.push([...ids]);
          return ok(new Map<AssetId, InterchangeMedia>([...media].filter(([id]) => ids.includes(id))));
        },
      },
    },
  });
  return { ...world, timeline, files, asked };
}

describe('timeline.exportInterchange', () => {
  it.each(['otio', 'fcpxml'] as const)(
    'writes a %s file into the exports folder, with its warnings',
    async (format) => {
      const { seed, dispatch, timeline, files, asked, bus } = setup();
      await seed(timeline);
      const done = await dispatch('timeline.exportInterchange', {
        projectId: timeline.projectId,
        timelineId: timeline.id,
        format,
      });
      if (!done.ok) throw new Error(done.error.detail);
      expect(done.value).toMatchObject({ fileName: `Test.${format}` });
      expect(files.files).toHaveLength(1);
      expect(files.files[0]?.text.length).toBeGreaterThan(1000);
      expect(asked[0]).toContain(timeline.music.path === 'ownTrack' ? timeline.music.assetId : '');
      const history = await bus.history(timeline.projectId);
      expect(history.ok && history.value.undo).toBeNull();
    },
  );

  it('refuses a revision that is not the current one', async () => {
    const { seed, dispatch, timeline, files } = setup();
    await seed(timeline);
    const stale = await dispatch('timeline.exportInterchange', {
      projectId: timeline.projectId,
      timelineId: timeline.id,
      format: 'otio',
      revision: timeline.revision + 1,
    });
    expect(!stale.ok && stale.error.code).toBe('core.conflict');
    expect(files.files).toHaveLength(0);
  });

  it('fails with timeline.interchange_mismatch and writes nothing when a writer moves a cut', async () => {
    const [otio] = EXPORTERS;
    const broken = defineExporter({
      ...otio,
      write(timeline, context) {
        const written = otio.write(timeline, context);
        if (!written.ok) return written;
        const cutList = written.value.cutList.map((entry, index) =>
          index === 3 ? { ...entry, frames: entry.frames + 1 } : entry,
        );
        return ok({ ...written.value, cutList });
      },
    });
    const { seed, dispatch, timeline, files } = setup(createExporterRegistry([broken]));
    await seed(timeline);
    const failed = await dispatch('timeline.exportInterchange', {
      projectId: timeline.projectId,
      timelineId: timeline.id,
      format: 'otio',
    });
    expect(!failed.ok && failed.error.code).toBe('timeline.interchange_mismatch');
    expect(files.files).toHaveLength(0);
  });

  it('passes a sink failure on, and answers not implemented without the interchange ports', async () => {
    const { seed, dispatch, timeline } = setup();
    await seed(timeline);
    const world = commandWorld();
    await world.seed(timeline);
    const missing = await world.dispatch('timeline.exportInterchange', {
      projectId: timeline.projectId,
      timelineId: timeline.id,
      format: 'otio',
    });
    expect(!missing.ok && missing.error.code).toBe('core.not_implemented');
    const unknown = await dispatch('timeline.exportInterchange', {
      projectId: timeline.projectId,
      timelineId: timeline.id,
      format: 'aaf',
    });
    expect(!unknown.ok && unknown.error.code).toBe('core.validation');
    const full = commandWorld({
      interchange: {
        exporters: createExporterRegistry(EXPORTERS),
        media: { resolve: async () => ok(new Map()) },
        files: { write: async () => err(DiskFull()) },
      },
    });
    await full.seed(timeline);
    const refused = await full.dispatch('timeline.exportInterchange', {
      projectId: timeline.projectId,
      timelineId: timeline.id,
      format: 'fcpxml',
    });
    expect(!refused.ok && refused.error.code).toBe('test.disk_full');
  });
});
