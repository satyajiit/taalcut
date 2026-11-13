// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library's template-library stores in the agent process (library-templates.ts) over a real library database:
 * with them registered, the template metadata commands, folders, starters, `templates.list`'s P3-V14 filters and
 * `styles.*` are served (LIBRARY_STORE_KEEPS_METADATA), and their writes commit with the command's audit row.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AuditLogStoreToken,
  ClockToken,
  CommandBusToken,
  connectRpc,
  createCommandBus,
  createContainer,
  createEventBus,
  createManualClock,
  EventBusToken,
  newId,
  serveRpc,
  STYLE_COMMANDS,
  StyleStoreToken,
  stylesContract,
  TEMPLATE_COMMANDS,
  TEMPLATE_FOLDER_COMMANDS,
  TemplateFolderStoreToken,
  templatesContract,
  TemplateStoreToken,
  unwrap,
  type CommandOrigin,
  type StyleInput,
} from '@taalcut/core';
import { createTemplateStore, openDatabase } from '@taalcut/library';
import { registerLibraryPorts } from '../src/shared/library-ports';
import { CommandUnitOfWorkToken, LibraryDatabaseToken } from '../src/shared/tokens';
import { agentTemplatesRouter, LIBRARY_STORE_KEEPS_METADATA } from '../src/utility/roots/agent-templates';
import { templatesHubRouters } from '../src/utility/roots/agent-templates-hub';
import {
  LibraryStyleStoreToken,
  registerLibraryTemplateStores,
} from '../src/utility/roots/library-templates';

const UI: CommandOrigin = { source: 'ui', actor: 'user' };
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function agentContainer() {
  const userData = mkdtempSync(join(tmpdir(), 'taalcut-library-templates-'));
  dirs.push(userData);
  const clock = createManualClock(Date.UTC(2026, 9, 15));
  const container = createContainer()
    .value(ClockToken, clock)
    .value(EventBusToken, createEventBus({ clock }))
    .value(LibraryDatabaseToken, unwrap(openDatabase({ path: ':memory:', clock: () => clock.now() })));
  registerLibraryPorts(container);
  container
    .factory(CommandBusToken, ({ store }) => createCommandBus({ store, clock }), {
      deps: { store: AuditLogStoreToken },
    })
    .factory(
      TemplateStoreToken,
      ({ db, commands }) => createTemplateStore(db, { assetsDir: join(userData, 'templates'), commands }),
      { deps: { db: LibraryDatabaseToken, commands: CommandUnitOfWorkToken } },
    );
  registerLibraryTemplateStores(container, { userData });
  return container;
}

function clients(container: ReturnType<typeof agentContainer>) {
  const templates = new MessageChannel();
  serveRpc(agentTemplatesRouter(container), templates.port1, { context: { caller: 'main' as const } });
  const styles = new MessageChannel();
  serveRpc(templatesHubRouters(container).styles, styles.port1, { context: { caller: 'main' as const } });
  return {
    templates: connectRpc(templatesContract, templates.port2).client,
    styles: connectRpc(stylesContract, styles.port2).client,
  };
}

const kit = (): StyleInput => ({
  name: 'Goa kit',
  kind: 'brandKit',
  colours: {
    primary: '#112233',
    secondary: '#445566',
    accent: '#ff8800',
    text: '#ffffff',
    background: '#000000',
  },
  fonts: { heading: { family: 'poppins', weight: 700 }, body: { family: 'notoSans', weight: 400 } },
  captions: null,
  textStyles: {},
  logo: null,
  watermark: null,
  intro: null,
  outro: null,
  grade: null,
  fontMatch: null,
  madeFrom: null,
});

describe('library template stores in the agent process', () => {
  it('registers the folder and Style stores lazily, the Style store once under both tokens', () => {
    const container = agentContainer();
    expect(LIBRARY_STORE_KEEPS_METADATA).toBe(true);
    expect(container.has(TemplateFolderStoreToken) && container.has(StyleStoreToken)).toBe(true);
    expect(container.resolve(StyleStoreToken)).toBe(container.resolve(LibraryStyleStoreToken));
  });

  it('serves starters, metadata commands, folders and the list filters, with undo', async () => {
    const container = agentContainer();
    const { templates } = clients(container);
    const bus = container.resolve(CommandBusToken);
    const starter = newId<'Template'>();
    const other = newId<'Template'>();
    for (const [templateId, starterId] of [
      [starter, 'festival-vlog'],
      [other, 'weekend-trip'],
    ] as const) {
      unwrap(
        await bus.dispatch(TEMPLATE_COMMANDS.addStarter, { projectId: null, starterId, templateId }, UI),
      );
    }
    const folderId = newId<'TemplateFolder'>();
    unwrap(
      await bus.dispatch(TEMPLATE_FOLDER_COMMANDS.create, { projectId: null, folderId, name: 'Trips' }, UI),
    );
    unwrap(
      await bus.dispatch(
        TEMPLATE_COMMANDS.moveToFolder,
        { projectId: null, templateIds: [starter], folderId },
        UI,
      ),
    );
    unwrap(
      await bus.dispatch(
        TEMPLATE_COMMANDS.setFavourite,
        { projectId: null, templateId: other, favourite: true },
        UI,
      ),
    );
    unwrap(
      await bus.dispatch(
        TEMPLATE_COMMANDS.setTags,
        { projectId: null, templateId: other, tags: ['goa'] },
        UI,
      ),
    );

    const ids = async (query: Parameters<typeof templates.list>[0]) =>
      (await templates.list(query)).items.map((item) => item.id);
    expect(await ids({ folderId })).toEqual([starter]);
    expect(await ids({ favourite: true })).toEqual([other]);
    expect(await ids({ tags: ['goa'] })).toEqual([other]);
    expect(await ids({ sort: 'name', dir: 'asc' })).toHaveLength(2);
    const summary = (await templates.get({ templateId: starter })).summary;
    expect(summary).toMatchObject({ folderId, provenance: { kind: 'starter', starterId: 'festival-vlog' } });
    expect(await templates.folders()).toMatchObject([{ id: folderId, name: 'Trips', templates: 1 }]);

    unwrap(await bus.dispatch(TEMPLATE_FOLDER_COMMANDS.remove, { projectId: null, folderId }, UI));
    expect(await templates.folders()).toEqual([]);
    expect(await ids({ folderId: 'none' })).toHaveLength(2);
    unwrap(await bus.undo(null, UI));
    expect(await ids({ folderId })).toEqual([starter]);
  });

  it('serves styles over the library store', async () => {
    const container = agentContainer();
    const { styles } = clients(container);
    const styleId = newId<'Style'>();
    unwrap(
      await container
        .resolve(CommandBusToken)
        .dispatch(STYLE_COMMANDS.create, { projectId: null, styleId, style: kit() }, UI),
    );
    expect((await styles.list()).map((style) => [style.id, style.name])).toEqual([[styleId, 'Goa kit']]);
    expect(await styles.usedBy({ styleId })).toEqual({ timelines: 0, templates: 0 });
  });
});
