// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1: writes the HyperFrames skills the Designer reads (`workspace.docs`) from their pinned upstream copy in
 * src/workspace/docs/skills: docs.lock.json pins the repo, tag, commit and licence and each file's sha256, and
 * docs.bundle.json holds the texts the app ships (a JSON import, so the bundle carries them). Only the skill's
 * Markdown is copied: its preset designs, fonts and scripts are not, since Taalcut ships no designs.
 *
 *   node packages/render/scripts/bundle-hyperframes-docs.mjs <upstream checkout at the pin>
 *
 * With no argument it rebuilds the bundle from the copies already in the tree and checks them against the lock.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

const DOCS = join(import.meta.dirname, '..', 'src', 'workspace', 'docs');
const SKILL = 'skills/hyperframes';
const PIN = {
  repo: 'https://github.com/heygen-com/hyperframes',
  tag: 'v0.8.209',
  commit: '53c975966611e7012b09b6d46707c26511ea077d',
  licence: 'Apache-2.0',
};

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

async function markdownUnder(root, folder) {
  const out = [];
  for (const entry of await readdir(join(root, folder), { withFileTypes: true })) {
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'assets' || entry.name === 'scripts') continue;
      out.push(...(await markdownUnder(root, path)));
    } else if (entry.name.endsWith('.md')) out.push(path);
  }
  return out.sort();
}

const upstream = process.argv[2];
if (upstream) {
  const head = execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (head !== PIN.commit) throw new Error(`${upstream} is at ${head}, not the pin ${PIN.commit}`);
  const licence = await readFile(join(upstream, 'LICENSE'), 'utf8');
  if (!licence.includes('Apache License') || !licence.includes('Version 2.0'))
    throw new Error('The upstream LICENSE is not the Apache-2.0 text');
  await copyFile(join(upstream, 'LICENSE'), join(DOCS, 'LICENSE'));
  for (const path of await markdownUnder(upstream, SKILL)) {
    await mkdir(dirname(join(DOCS, path)), { recursive: true });
    await copyFile(join(upstream, path), join(DOCS, path));
  }
}

const files = [];
for (const path of await markdownUnder(DOCS, SKILL)) {
  const text = await readFile(join(DOCS, path), 'utf8');
  files.push({ path, sha256: sha256(text), bytes: Buffer.byteLength(text, 'utf8'), text });
}
const lock = {
  ...PIN,
  note: "The hyperframes skill's Markdown only; its preset designs, fonts and scripts are left out.",
  licenceFile: 'LICENSE',
  licenceSha256: sha256(await readFile(join(DOCS, 'LICENSE'))),
  files: files.map(({ path, sha256: hash, bytes }) => ({ path, sha256: hash, bytes })),
};
await writeFile(join(DOCS, 'docs.lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
await writeFile(
  join(DOCS, 'docs.bundle.json'),
  `${JSON.stringify({ commit: PIN.commit, files: files.map(({ path, text }) => ({ path, text })) })}\n`,
);
console.warn(`${files.length} files from ${PIN.repo} ${PIN.tag} into ${relative(process.cwd(), DOCS)}`);
