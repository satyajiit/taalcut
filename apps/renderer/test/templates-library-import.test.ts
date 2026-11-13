// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { callRpc, HUB_MAX_BYTES } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { GOLDEN_HOUR, MORNING, templateIdOf } from '../src/backend/fake/templates/template-data';
import { importTemplateFiles, type ImportFile } from '../src/features/templates/library/import-templates';

const file = (name: string, text: string, size = text.length): ImportFile => ({
  name,
  size,
  text: () => Promise.resolve(text),
});

describe('importing template files', () => {
  it('imports the good files, names the refused ones, and is one undo per command', async () => {
    const { client } = createFakeBackend({ phase2: { library: { tickMs: 0 } } });
    const golden = await client.templates.exportDocument({ templateId: templateIdOf(GOLDEN_HOUR) });
    const morning = await client.templates.exportDocument({ templateId: templateIdOf(MORNING) });
    let commands = 0;
    const outcome = await importTemplateFiles(
      [
        file(golden.fileName, golden.text),
        file('broken.taalcut-template', '{"format":"taalcut.template"}'),
        file('notes.txt', 'hello'),
        file('huge.taalcut-template', '{}', HUB_MAX_BYTES + 1),
        file(morning.fileName, morning.text),
        { name: 'gone.taalcut-template', size: 10, text: () => Promise.reject(new Error('gone')) },
      ],
      (items) => {
        commands += 1;
        return callRpc(
          client.commands.dispatch({
            name: 'template.import',
            payload: { projectId: null, items },
            source: 'ui',
          }),
        );
      },
    );
    expect(outcome.error).toBeNull();
    expect(outcome.imported).toHaveLength(2);
    expect(outcome.steps).toBe(1);
    // The bad file was refused by the service, then the rest sent again.
    expect(commands).toBe(2);
    expect(outcome.refused).toEqual([
      { name: 'notes.txt', reason: 'notTemplate' },
      { name: 'huge.taalcut-template', reason: 'tooLarge' },
      { name: 'gone.taalcut-template', reason: 'unreadable' },
      { name: 'broken.taalcut-template', reason: 'invalid' },
    ]);
    const names = (await client.templates.list({ limit: 200 })).items.map((item) => item.name);
    expect(names.filter((name) => name === 'Golden hour market')).toHaveLength(2);
    await client.commands.undo({ projectId: null, source: 'ui' });
    expect((await client.templates.list({ limit: 200 })).items).toHaveLength(3);
  });

  it('stops on a failure that is not one file’s fault', async () => {
    const outcome = await importTemplateFiles([file('a.taalcut-template', '{}')], () =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'core.timeout', messageKey: 'errors.core.timeout', retryable: true },
      }),
    );
    expect(outcome.error?.code).toBe('core.timeout');
    expect(outcome.imported).toEqual([]);
  });
});
