// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HyperFrames' skills, bundled (HFW1 dsn): the copies match the lock's sha256s, the lock pins heygen-com/hyperframes
 * at v0.8.209 under Apache-2.0 with its licence, the bundle the app ships is exactly the copies, nothing but Markdown
 * came along (no preset designs, fonts or scripts), and `workspace.docs` lists and pages them.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { unwrap } from '@taalcut/core';
import bundle from '../../../src/workspace/docs/docs.bundle.json';
import lock from '../../../src/workspace/docs/docs.lock.json';
import { DOCS_PAGE_CHARS, DOCS_TOPICS, workspaceDocsTool } from '../../../src/workspace/tools/docs-tool';

const DOCS = join(import.meta.dirname, '..', '..', '..', 'src', 'workspace', 'docs');
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(path)));
    else out.push(relative(DOCS, path));
  }
  return out.sort();
}

const run = (input: Record<string, unknown>) => {
  const tool = workspaceDocsTool();
  return tool.run(tool.input.parse(input), {} as never);
};

describe('the HyperFrames skills bundle', () => {
  it('pins the upstream repo, tag, commit and Apache-2.0 licence', async () => {
    expect(lock).toMatchObject({
      repo: 'https://github.com/heygen-com/hyperframes',
      tag: 'v0.8.209',
      commit: '53c975966611e7012b09b6d46707c26511ea077d',
      licence: 'Apache-2.0',
    });
    const licence = await readFile(join(DOCS, 'LICENSE'));
    expect(sha(licence)).toBe(lock.licenceSha256);
    expect(licence.toString('utf8')).toContain('Apache License');
    expect(bundle.commit).toBe(lock.commit);
  });

  it('holds exactly the locked Markdown, byte for byte, and ships the same texts', async () => {
    const files = await filesUnder(DOCS);
    expect(files.filter((path) => path.startsWith('skills/'))).toEqual(
      lock.files.map((file) => file.path).sort(),
    );
    expect(
      files.every(
        (path) => path.endsWith('.md') || ['LICENSE', 'docs.lock.json', 'docs.bundle.json'].includes(path),
      ),
    ).toBe(true);
    for (const file of lock.files) {
      const text = await readFile(join(DOCS, file.path), 'utf8');
      expect(sha(text), file.path).toBe(file.sha256);
      expect(Buffer.byteLength(text, 'utf8')).toBe(file.bytes);
      expect(bundle.files.find((entry) => entry.path === file.path)?.text).toBe(text);
    }
    expect(bundle.files).toHaveLength(lock.files.length);
  });

  it('lists the topics, pages one, and names the topics when asked for another', async () => {
    const index = await run({});
    if (!index.ok) throw new Error(index.error.code);
    const topics = index.value.topics?.map((entry) => entry.topic) ?? [];
    expect(topics).toEqual(
      expect.arrayContaining([
        'hyperframes',
        'format',
        'motion',
        'overlays',
        'types/vertical',
        'taalcut/hallmark-thumbnails',
        'taalcut/tone-audio',
      ]),
    );
    const hallmark = await run({ topic: 'taalcut/hallmark-thumbnails' });
    expect(hallmark.ok && hallmark.value.text).toContain('Hallmark Video Covers');
    expect(index.value.note).toContain('workspace.lint');
    expect(index.value.note).toContain('workspace.exec');
    expect(index.value.note).toContain('workspace.importMedia');
    const motion = DOCS_TOPICS.find((entry) => entry.topic === 'motion')!;
    const first = await run({ topic: 'motion' });
    if (!first.ok) throw new Error(first.error.code);
    expect(first.value.text?.length).toBeLessThanOrEqual(DOCS_PAGE_CHARS);
    const pages = first.value.pages ?? 1;
    let joined = '';
    for (let page = 1; page <= pages; page++) {
      const part = await run({ topic: 'motion', page });
      if (!part.ok) throw new Error(part.error.code);
      joined += part.value.text ?? '';
    }
    expect(joined).toBe(motion.text);
    const unknown = await run({ topic: 'registry' });
    expect(unknown.ok ? '' : unknown.error.detail).toContain('hyperframes');
  });

  it('keeps every workspace.docs page under 8,192 UTF-8 bytes, supports aliases, and recommends GPU encoding', async () => {
    const index = await run({});
    if (!index.ok) throw new Error(index.error.code);
    expect(Buffer.byteLength(JSON.stringify(index.value), 'utf8')).toBeLessThan(8_192);
    expect(index.value.note).toContain('h264_videotoolbox');

    for (const entry of DOCS_TOPICS) {
      const first = await run({ topic: entry.topic, page: 1 });
      if (!first.ok) throw new Error(`${entry.topic}: ${first.error.code}`);
      const pages = first.value.pages ?? 1;
      for (let page = 1; page <= pages; page++) {
        const part = await run({ topic: entry.topic, page });
        if (!part.ok) throw new Error(`${entry.topic} p${page}: ${part.error.code}`);
        expect(
          Buffer.byteLength(JSON.stringify(part.value), 'utf8'),
          `${entry.topic} page ${page}/${pages}`,
        ).toBeLessThan(8_192);
      }
    }

    const motionAlias = await run({ topic: 'taalcut/impeccable-motion' });
    expect(motionAlias.ok && motionAlias.value.topic).toBe('taalcut/impeccable-craft');
    const designAlias = await run({ topic: 'taalcut/hallmark-design' });
    expect(designAlias.ok && designAlias.value.topic).toBe('taalcut/hallmark-thumbnails');
    const sandbox = await run({ topic: 'taalcut/sandbox-workspace' });
    expect(sandbox.ok && sandbox.value.text).toContain('workspace.open({ projectId, inputs })');
    expect(sandbox.ok && sandbox.value.text).not.toContain('workspace.open({ assetIds })');
  });
});

it('keeps conditional editing recipes exact, discoverable and small enough to read beside a schema', async () => {
  const guides = DOCS_TOPICS.filter((entry) => /^taalcut\/(edit|make)-/.test(entry.topic));
  expect(guides.map((entry) => entry.topic)).toEqual(
    expect.arrayContaining([
      'taalcut/edit-cover',
      'taalcut/edit-text',
      'taalcut/make-film',
      'taalcut/make-voice',
      'taalcut/edit-motion',
    ]),
  );
  for (const guide of guides) {
    const first = unwrap(await run({ topic: guide.topic }));
    let full = '';
    for (let page = 1; page <= first.pages!; page++) {
      const result = unwrap(await run({ topic: guide.topic, page }));
      expect(result.note).toContain('Built-in Taalcut editing guide');
      expect(result.note).not.toContain('npx');
      expect(result.text!.length).toBeLessThanOrEqual(1600);
      full += result.text;
    }
    expect(full).toBe(guide.text);
  }
  expect(guides.find((g) => g.topic === 'taalcut/edit-targets')!.text).toContain(
    'timeline.setSpeed with clip "this", then timeline.setTransition',
  );
  expect(guides.find((g) => g.topic === 'taalcut/make-film')!.text).toContain('exact frame range');
  expect(guides.find((g) => g.topic === 'taalcut/make-voice')!.text).toContain('models.not_configured');
  expect(guides.find((g) => g.topic === 'taalcut/edit-cover')!.text).toContain(
    'never silently replace requested generated imagery',
  );
});
