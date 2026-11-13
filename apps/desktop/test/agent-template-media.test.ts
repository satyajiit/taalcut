// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * REF1-KEEP in the agent process (agent-template-media.ts), over a real library database: the media store under
 * `<userData>/templates/media`, a template's media folder gone once its delete commits (and with an undo of what
 * made it), and the router's `templates.fetchMedia`, which answers `templates.no_origin_link` for a format plan.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  createDirectJobRunner,
  createEventBus,
  createManualClock,
  EventBusToken,
  ExperimentSandboxToken,
  JobRunnerToken,
  newId,
  serveRpc,
  TEMPLATE_COMMANDS,
  TemplateMediaStoreToken,
  templatesContract,
  TemplateStoreToken,
  unwrap,
  type CommandOrigin,
  type ExperimentSandbox,
  type Template,
} from '@taalcut/core';
import { createTemplateStore, openDatabase, templateMediaFolder } from '@taalcut/library';
import { planFormat } from '@taalcut/templates';
import { registerLibraryPorts } from '../src/shared/library-ports';
import { templatesRoot } from '../src/shared/template-assets';
import { CommandUnitOfWorkToken, LibraryDatabaseToken } from '../src/shared/tokens';
import { mayRemoveTemplate, registerTemplateMedia } from '../src/utility/roots/agent-template-media';
import { agentTemplatesRouter } from '../src/utility/roots/agent-templates';

const UI: CommandOrigin = { source: 'ui', actor: 'user' };
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function agent() {
  const userData = mkdtempSync(join(tmpdir(), 'taalcut-template-media-'));
  dirs.push(userData);
  const clock = createManualClock(Date.UTC(2026, 9, 29));
  const container = createContainer()
    .value(ClockToken, clock)
    .value(EventBusToken, createEventBus({ clock }))
    .value(LibraryDatabaseToken, unwrap(openDatabase({ path: ':memory:', clock: () => clock.now() })))
    // A sandbox and a runner, so the router serves templates.fetchMedia; nothing here fetches.
    .value(ExperimentSandboxToken, {} as ExperimentSandbox)
    .value(JobRunnerToken, createDirectJobRunner([]));
  registerLibraryPorts(container);
  container
    .factory(CommandBusToken, ({ store }) => createCommandBus({ store, clock }), {
      deps: { store: AuditLogStoreToken },
    })
    .factory(
      TemplateStoreToken,
      ({ db, commands }) =>
        createTemplateStore(db, { assetsDir: join(templatesRoot(userData), 'assets'), commands }),
      { deps: { db: LibraryDatabaseToken, commands: CommandUnitOfWorkToken } },
    );
  registerTemplateMedia(container, { userData });
  return { container, userData, bus: container.resolve(CommandBusToken) };
}

function plan(): Template {
  return unwrap(
    planFormat(
      { formatId: 'vlog', targetSeconds: 20, brief: 'a slow morning', createdAt: 1 },
      { template: () => newId(), slot: () => newId(), overlay: () => newId() },
    ),
  );
}

describe('template media in the agent process', () => {
  it('keeps media under <userData>/templates/media, and a delete takes the folder once it commits', async () => {
    const { container, userData, bus } = agent();
    agentTemplatesRouter(container);
    const media = container.resolve(TemplateMediaStoreToken);
    const kept = async (template: Template) => {
      const reel = join(userData, `${template.id}.mp4`);
      writeFileSync(reel, 'reel');
      unwrap(
        await media.keep(template.id, {
          path: reel,
          mode: 'move',
          durationMs: 20_000,
          hasAudio: true,
          source: 'anonymous',
        }),
      );
      return templateMediaFolder(templatesRoot(userData), template.id);
    };

    const deleted = plan();
    unwrap(
      await bus.dispatch(
        TEMPLATE_COMMANDS.create,
        { projectId: null, template: deleted, name: 'A', listed: true },
        UI,
      ),
    );
    const folder = await kept(deleted);
    expect(folder).toBe(join(userData, 'templates', 'media', deleted.id));
    expect(existsSync(join(folder, 'reference.mp4'))).toBe(true);
    unwrap(await bus.dispatch(TEMPLATE_COMMANDS.remove, { projectId: null, templateId: deleted.id }, UI));
    expect(existsSync(folder)).toBe(false);

    // Undoing what made a template removes it, and its media with it.
    const undone = plan();
    unwrap(
      await bus.dispatch(
        TEMPLATE_COMMANDS.create,
        { projectId: null, template: undone, name: 'B', listed: true },
        UI,
      ),
    );
    const second = await kept(undone);
    unwrap(await bus.undo(null, UI));
    expect(existsSync(second)).toBe(false);
  });

  it('serves templates.fetchMedia, which a format plan answers with no_origin_link', async () => {
    const { container, bus } = agent();
    const { port1, port2 } = new MessageChannel();
    serveRpc(agentTemplatesRouter(container), port1, { context: { caller: 'main' as const } });
    const client = connectRpc(templatesContract, port2).client;
    const template = plan();
    unwrap(
      await bus.dispatch(
        TEMPLATE_COMMANDS.create,
        { projectId: null, template, name: 'C', listed: true },
        UI,
      ),
    );
    expect((await client.get({ templateId: template.id })).summary.media).toBeNull();
    await expect(client.fetchMedia({ id: template.id })).rejects.toMatchObject({
      data: { code: 'templates.no_origin_link' },
    });
    port1.close();
  });

  it('prunes after deletes, discards and undos, and not after edits', () => {
    expect(mayRemoveTemplate({ kind: 'executed', name: TEMPLATE_COMMANDS.remove })).toBe(true);
    expect(mayRemoveTemplate({ kind: 'executed', name: TEMPLATE_COMMANDS.discardMany })).toBe(true);
    expect(mayRemoveTemplate({ kind: 'undone', name: TEMPLATE_COMMANDS.create })).toBe(true);
    expect(mayRemoveTemplate({ kind: 'undone', name: 'hub.fork' })).toBe(true);
    expect(mayRemoveTemplate({ kind: 'executed', name: TEMPLATE_COMMANDS.rename })).toBe(false);
    expect(mayRemoveTemplate({ kind: 'redone', name: TEMPLATE_COMMANDS.create })).toBe(false);
  });
});
