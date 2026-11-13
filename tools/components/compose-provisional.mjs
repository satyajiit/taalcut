#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Writes manifest.provisional.json: every manifest source in this folder as
 * one manifest, the file the app ships once signed (manifest.signed.json).
 * Each source's `$comment` (where its files come from and how they were made)
 * is kept in the union's own `$comment`, by file, because sign-manifest.mjs
 * drops comments. Dependencies across files that a single file can't name
 * are added here (Beat This! and Silero VAD run on the onnxruntime component).
 * The sources keep their `.provisional` names because other packages' tests
 * and docs read them by path; every file in them is hosted
 * (hosting/write-manifest.mjs writes their urls).
 *
 *   node tools/components/compose-provisional.mjs
 *   node tools/components/sign-manifest.mjs tools/components/manifest.provisional.json \
 *        --out tools/components/manifest.signed.json --sequence <last + 1>
 *
 * Duplicate ids across files are an error. Node built-ins only.
 *
 * A file may also `extend` components another file has: { "<id>": { "artifacts": [...], "variants": [...],
 * "requires": {...}, "licence": {...} } } adds those artifacts and sets the rest (a component's one notice names
 * every artifact, so a new platform brings a new licence notice). PENDING lists files whose
 * components aren't hosted yet: they stay out of the union the app ships until a release hosts them, and
 * `compose(read, { pending: true })` (CLI: --pending --out <file>) adds them for that release's build
 * (hosting/build.mjs --pending). Once hosted, the file moves from PENDING to SOURCES, as the linux-x64 builds
 * (LNX1-CMP, manifest.linux.provisional.json) did on 2026-10-28, the Indian-language identifier (LIB1-LANG,
 * manifest.anuvani.provisional.json) on 2026-10-29, and the listening models and the SFX bank (EAR1,
 * manifest.listen.provisional.json and manifest.sfx-bank.provisional.json) on 2026-11-07.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const DIR = dirname(fileURLToPath(import.meta.url));
/** Runtimes before the models that need them, then tools. */
export const SOURCES = [
  'manifest.local-llm.provisional.json',
  'manifest.vision.provisional.json',
  'manifest.audio.provisional.json',
  'manifest.render.provisional.json',
  'manifest.reference-fetcher.provisional.json',
  'manifest.voice-music.provisional.json',
  'manifest.linux.provisional.json',
  'manifest.anuvani.provisional.json',
  'manifest.listen.provisional.json',
  'manifest.sfx-bank.provisional.json',
  'manifest.workspace.provisional.json',
  'manifest.subjects.provisional.json',
  'manifest.local-llm-mlx.provisional.json',
];
/** Files whose components aren't hosted yet: added only for the release that hosts them. */
export const PENDING = [];
/** id → dependencies its own file can't name. */
const CROSS_FILE_DEPENDENCIES = {
  'beat-this': ['onnxruntime'],
  'silero-vad': ['onnxruntime'],
  'anuvani-lid': ['onnxruntime'],
  // EAR1-F3: the listening models, each build of them.
  'clap-general-audio': ['onnxruntime'],
  'clap-general-audio-fp16': ['onnxruntime'],
  'clap-general-text': ['onnxruntime'],
  'clap-general-text-fp16': ['onnxruntime'],
  'ast-audioset': ['onnxruntime'],
  'ast-audioset-fp16': ['onnxruntime'],
};
export const OUTPUT = 'manifest.provisional.json';

/** `component` with an `extend` entry applied: its artifacts added, its variants, requires and licence set. */
function extended(component, extension, name) {
  const platforms = component.artifacts.map((artifact) => artifact.platform);
  for (const artifact of extension.artifacts ?? [])
    if (platforms.includes(artifact.platform))
      throw new Error(`${name}: '${component.id}' has a ${artifact.platform} artifact already`);
  const { artifacts = [], ...fields } = extension;
  return { ...component, ...fields, artifacts: [...component.artifacts, ...artifacts] };
}

export function compose(
  read = (name) => JSON.parse(readFileSync(join(DIR, name), 'utf8')),
  { pending = false } = {},
) {
  const names = pending ? [...SOURCES, ...PENDING] : SOURCES;
  const components = [];
  const comments = [];
  const extensions = [];
  for (const name of names) {
    const manifest = read(name);
    if (manifest.$comment) comments.push(`[${name}] ${manifest.$comment}`);
    for (const component of manifest.components) {
      if (components.some((c) => c.id === component.id))
        throw new Error(`${name}: component '${component.id}' is in another provisional manifest too`);
      const extra = CROSS_FILE_DEPENDENCIES[component.id] ?? [];
      components.push({
        ...component,
        dependencies: [...new Set([...component.dependencies, ...extra])],
      });
    }
    for (const [id, extension] of Object.entries(manifest.extend ?? {}))
      extensions.push({ id, extension, name });
  }
  for (const { id, extension, name } of extensions) {
    const index = components.findIndex((c) => c.id === id);
    if (index < 0) throw new Error(`${name}: it extends '${id}', which no manifest has`);
    components[index] = extended(components[index], extension, name);
  }
  return {
    $comment: [
      `The union of ${names.join(', ')}, written by compose-provisional.mjs; edit those files, not this one.`,
      'Every file is hosted at https://components.taalcut.app (tools/components/hosting). Where each one comes from:',
      ...comments,
    ].join(' '),
    schemaVersion: 1,
    components,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { pending: { type: 'boolean' }, out: { type: 'string' } } });
  const union = compose(undefined, { pending: values.pending ?? false });
  const out = values.out ?? join(DIR, OUTPUT);
  if (values.pending && !values.out) throw new Error('--pending writes elsewhere: give --out <file>');
  writeFileSync(out, `${JSON.stringify(union, null, 2)}\n`);
  console.log(`${out}: ${union.components.map((c) => c.id).join(', ')}`);
}
