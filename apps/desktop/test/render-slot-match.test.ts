// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The render root's slotMatch port (AGT2-MATCH) over a migrated library: a timeline that follows no template gives
 * null; one that does gets its template version back, read through the store, and its shots' word (none here: the
 * made-up library has no analysed shots). Without a port to main, needs are read by their words only.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createContainer,
  createManualClock,
  newId,
  unwrap,
  type ProjectId,
  type Timeline,
} from '@taalcut/core';
import { createTemplateStore, openDatabase } from '@taalcut/library';
import { syntheticTemplate } from '@taalcut/templates';
import { LibraryDatabaseToken } from '../src/shared/tokens';
import { renderSlotMatch } from '../src/utility/roots/render-slot-match';

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("the render root's slotMatch port", () => {
  it('reads the template a timeline follows, and nothing for one that follows none', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'taalcut-slot-match-'));
    dirs.push(dir);
    const db = unwrap(openDatabase({ path: join(dir, 'library.sqlite') }));
    const store = createTemplateStore(db, { assetsDir: join(dir, 'templates', 'assets') });
    const made = syntheticTemplate({ index: 1, shots: [30, 30] });
    unwrap(await store.create(made, { name: 'Made up', projectId: null, listed: true }));
    const container = createContainer();
    container.value(LibraryDatabaseToken, db);
    const port = renderSlotMatch(container, { userData: dir }, createManualClock(0), undefined).slotMatch!;
    const timeline = { template: null, tracks: [] } as unknown as Timeline;
    const projectId = newId<'Project'>() as ProjectId;
    expect(await port({ projectId, timeline })).toEqual({ ok: true, value: null });
    const following = {
      ...timeline,
      template: { id: made.id, version: 1 },
      tracks: [{ kind: 'video', id: newId<'Track'>(), items: [] }],
      cast: null,
    } as unknown as Timeline;
    const sourced = unwrap(await port({ projectId, timeline: following }));
    expect(sourced?.template.slots.map((slot) => slot.id)).toEqual(made.slots.map((slot) => slot.id));
    expect(sourced?.shots).toEqual([]);
    db.close();
  });
});
