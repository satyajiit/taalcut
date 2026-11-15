// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CAP1: post captions as the agent process composes them. The credit switch is a remembered setting only a
 * person's command changes; the Editor has `timeline.setPostCaption`, and the tool reads the switch from the
 * settings store, so the model never decides whether the credit line is there.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CommandBusToken,
  connectRpc,
  ok,
  POST_CAPTION_COMMAND,
  POST_CAPTION_SETTING_COMMANDS,
  serveRpc,
  UTILITY_CONTRACTS,
} from '@taalcut/core';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolRegistryToken } from '../src/shared/tokens';
import { SkillRegistryToken } from '../src/utility/roots/agent-flows';
import { closeAllPorts, nodeChannel } from './helpers/fake-utility';
import { testAgent, testConfig } from './helpers/roots';

afterEach(closeAllPorts);

const ids = { projectId: '01000000000000000000000001', timelineId: '01000000000000000000000002' };
const PARTS = {
  ...ids,
  platform: 'instagram',
  body: 'Lanterns over the old quarter.',
  hashtags: ['hanoi'],
  keywords: ['hanoi night market', 'old quarter lanterns', 'street food'],
};

function connect(root: ReturnType<typeof testAgent>) {
  const port = nodeChannel();
  serveRpc(root.router, port.local, { context: { caller: 'main' } });
  return connectRpc(UTILITY_CONTRACTS.agent, port.remote, { peer: 'agent' }).client;
}

/** The text the live tool hands its command, with the command itself stood in for. */
async function built(root: ReturnType<typeof testAgent>): Promise<string> {
  const tool = root.container.resolve(ToolRegistryToken).resolve(POST_CAPTION_COMMAND)!;
  let text = '';
  const done = await tool.spec.run(tool.spec.input.parse(PARTS), {
    artifacts: {},
    async dispatch(payload: { text: string }) {
      text = payload.text;
      return ok({ timelineId: ids.timelineId, revision: 2, platform: 'instagram', text });
    },
  } as never);
  expect(done.ok).toBe(true);
  return text;
}

describe('desktop post captions (CAP1)', () => {
  it('keeps the credit on until a person turns it off, across a restart, and the tool follows it', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'taalcut-post-caption-'));
    const config = testConfig('agent', join(directory, 'library.sqlite'), directory);
    const first = testAgent(config);
    try {
      const client = connect(first);
      expect(await client.postCaption.credit()).toEqual({ enabled: true });
      expect(await built(first)).toBe(
        'Lanterns over the old quarter.\n\nCreated with @taalcut.app\n\n#hanoi\n\n' +
          '(hanoi night market, old quarter lanterns, street food)',
      );
      // The model cannot turn it off: the command takes a person's dispatch only.
      const bus = first.container.resolve(CommandBusToken);
      for (const source of ['agent', 'mcp'] as const) {
        const refused = await bus.dispatch(
          POST_CAPTION_SETTING_COMMANDS.setCredit,
          { enabled: false },
          { source, actor: `${source}:test` },
        );
        expect(refused).toMatchObject({ ok: false, error: { code: 'core.command_source_refused' } });
      }
      expect(await client.postCaption.credit()).toEqual({ enabled: true });

      await client.commands.dispatch({
        name: POST_CAPTION_SETTING_COMMANDS.setCredit,
        payload: { enabled: false },
        source: 'ui',
      });
      expect(await client.postCaption.credit()).toEqual({ enabled: false });
      expect(await built(first)).toBe(
        'Lanterns over the old quarter.\n\n#hanoi\n\n(hanoi night market, old quarter lanterns, street food)',
      );
    } finally {
      closeAllPorts();
      await first.container.dispose();
    }
    const second = testAgent(config);
    try {
      expect(await connect(second).postCaption.credit()).toEqual({ enabled: false });
      expect(await built(second)).not.toContain('@taalcut.app');
    } finally {
      closeAllPorts();
      await second.container.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('gives the Editor the caption tool, a local write of its command', () => {
    const root = testAgent(testConfig('agent'), { main: nodeChannel().remote });
    try {
      const tool = root.container.resolve(ToolRegistryToken).resolve(POST_CAPTION_COMMAND)!;
      expect(tool.descriptor).toMatchObject({
        name: 'timeline.setPostCaption',
        version: '1.0.0',
        costClass: 'local',
        sideEffect: 'write',
      });
      const editor = root.container.resolve(SkillRegistryToken).get('timeline.editor')!;
      expect(editor.tools.names).toContain('timeline.setPostCaption');
    } finally {
      void root.container.dispose();
    }
  });
});
