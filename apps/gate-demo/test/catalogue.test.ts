// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-FIX: the demo offers the agent the catalogue its session was recorded with (fixtures/gate-demo.catalogue.txt,
 * src/catalogue.ts). The desktop's agent process is held to the same file and to the make flow's (its
 * test/agent-catalogue.test.ts), so a module added on one side only fails here or there, by name, instead of as a
 * replay miss in the desktop's journeys. Recording the gate demo's session (TAALCUT_RECORD=1) writes the file.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { defineToolModule } from '@taalcut/core';
import { createBinaryResolver } from '@taalcut/media';
import {
  catalogueDrift,
  catalogueOf,
  createRecordedGateModels,
  GATE_DEMO_FIXTURES,
  GATE_DEMO_SESSION,
  MAKE_FLOW_SESSION,
  recordCatalogues,
  recordedCatalogue,
  writeRecordedCatalogue,
} from '../src/index';
import { composeGateDemo } from './compose';
import { pluginModules } from './compose-phase3';

const root = mkdtempSync(join(tmpdir(), 'taalcut-catalogue-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

it('offers the agent exactly the catalogue its session was recorded with', () => {
  mkdirSync(join(root, 'app-data'));
  const demo = composeGateDemo({
    databasePath: join(root, 'library.db'),
    resolver: createBinaryResolver({ development: true }),
    home: root,
    appData: join(root, 'app-data'),
    models: createRecordedGateModels(GATE_DEMO_FIXTURES, { home: root, mode: 'replay' }),
  });
  recordCatalogues([GATE_DEMO_SESSION], demo.toolModules);
  const offered = catalogueOf(demo.toolModules);
  demo.close();
  expect(
    catalogueDrift(recordedCatalogue(GATE_DEMO_SESSION) ?? [], offered),
    `the demo offers tools its session was not recorded with: re-record (${GATE_DEMO_SESSION.rerecord})`,
  ).toEqual([]);
  // The desktop's plugins module is part of it (missing here, it broke the desktop's replay).
  expect(offered.filter((line) => line.startsWith('plugins '))).toHaveLength(7);
  expect(offered.filter((line) => line.startsWith('products '))).toHaveLength(4);
});

describe('catalogue lines', () => {
  afterEach(() => vi.unstubAllEnvs());
  const [plugins] = pluginModules();
  if (!plugins) throw new Error('compose-phase3 offers no plugins module');

  it('are one per tool, in order, and change with what the model reads', () => {
    const lines = catalogueOf([plugins]);
    expect(lines.map((line) => line.split(' ')[1])).toEqual(plugins.tools.map((tool) => tool.name));
    expect(catalogueOf([plugins])).toEqual(lines);
    const [first, ...rest] = plugins.tools;
    if (!first) throw new Error('the plugins module has no tools');
    const reworded = defineToolModule({
      id: plugins.id,
      tools: [{ ...first, description: `${first.description} Reworded.` }, ...rest],
    });
    const [changed, ...same] = catalogueOf([reworded]);
    expect(changed).not.toBe(lines[0]);
    expect(same).toEqual(lines.slice(1));
  });

  it('read back from the file as written, the header left out, one file per session', () => {
    const fixtures = join(root, 'fixtures');
    mkdirSync(fixtures);
    expect(recordedCatalogue(MAKE_FLOW_SESSION, fixtures)).toBeUndefined();
    const lines = catalogueOf([plugins]);
    writeRecordedCatalogue(MAKE_FLOW_SESSION, lines, fixtures);
    expect(recordedCatalogue(MAKE_FLOW_SESSION, fixtures)).toEqual(lines);
    expect(recordedCatalogue(GATE_DEMO_SESSION, fixtures)).toBeUndefined();
  });

  it('are written while a session is recorded, for that session only', () => {
    const fixtures = join(root, 'recording');
    mkdirSync(fixtures);
    vi.stubEnv('TAALCUT_RECORD', '0');
    recordCatalogues([GATE_DEMO_SESSION, MAKE_FLOW_SESSION], [plugins], fixtures);
    expect(recordedCatalogue(MAKE_FLOW_SESSION, fixtures)).toBeUndefined();
    vi.stubEnv('TAALCUT_RECORD', '1');
    vi.stubEnv('TAALCUT_RECORD_SESSION', MAKE_FLOW_SESSION.name);
    recordCatalogues([GATE_DEMO_SESSION, MAKE_FLOW_SESSION], [plugins], fixtures);
    expect(recordedCatalogue(MAKE_FLOW_SESSION, fixtures)).toEqual(catalogueOf([plugins]));
    expect(recordedCatalogue(GATE_DEMO_SESSION, fixtures)).toBeUndefined();
  });

  it('drift names what was added and dropped, and a change of order alone', () => {
    expect(catalogueDrift(['a', 'b'], ['a', 'b'])).toEqual([]);
    expect(catalogueDrift(['a', 'b'], ['a', 'c'])).toEqual(['+ c', '- b']);
    expect(catalogueDrift(['a', 'b'], ['b', 'a'])).toEqual(['order']);
  });
});
