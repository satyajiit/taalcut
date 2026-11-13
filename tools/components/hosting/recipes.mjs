// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The recipe kinds plan.mjs names. Each one makes a component's hosted file inside `ctx.stage` (a fresh empty
 * folder) from pinned sources and returns { path, install }: `install` is the manifest's install spec without
 * extractedSize (build.mjs measures that from the bytes). The existing pack and build scripts are reused as they
 * are and run from the repository root.
 */
import { execFile } from 'node:child_process';
import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { extract, packTarZst } from './archive.mjs';
import { cargoNotice } from './cargo-notices.mjs';
import { signFile, signTree } from './codesign.mjs';
import { listEntries, sha256Hex } from './files.mjs';
import { checkPin, pinned } from './pinned.mjs';
import { TEXTS } from './texts.mjs';

const exec = promisify(execFile);
const archive = (format, stripComponents = 0) => ({ type: 'archive', format, stripComponents });

/** The recogniser's character list (rec/inference.yml, `character_dict`) as vision reads it: a JSON array. */
export function paddleCharset(yml) {
  const lines = yml.split('\n');
  const start = lines.findIndex((line) => /^\s*character_dict:\s*$/.test(line));
  if (start < 0) throw new Error('no character_dict in inference.yml');
  const characters = [];
  for (const line of lines.slice(start + 1)) {
    const item = /^\s*- (.*)$/.exec(line);
    if (!item) break;
    const value = item[1];
    if (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
      characters.push(value.slice(1, -1).replaceAll("''", "'"));
    else if (value.startsWith('"')) characters.push(JSON.parse(value));
    else characters.push(value.trim());
  }
  if (characters.length === 0) throw new Error('character_dict is empty');
  return `[${characters.map((c) => JSON.stringify(c)).join(', ')}]`;
}

const GENERATORS = { 'paddle-charset': paddleCharset };

/** The JSON object a pack script prints last (one line, or pretty-printed). */
export function lastJson(stdout) {
  const lines = stdout.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith('{')) continue;
    try {
      return JSON.parse(lines.slice(i).join('\n'));
    } catch {
      // Not the start of the object: keep looking further up.
    }
  }
  throw new Error(`no JSON summary in the output:\n${stdout.slice(-2000)}`);
}

async function runScript(ctx, command, env = {}) {
  ctx.log(`run ${command.join(' ')}`);
  const { stdout } = await exec(command[0], command.slice(1), {
    cwd: ctx.repo,
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

async function placeholder(ctx, arg) {
  const match = /^\{(\w+)(?::([\w.-]+))?\}(.*)$/.exec(arg);
  if (!match) return arg;
  const [, kind, name, rest] = match;
  if (kind === 'stage') return `${ctx.stage}${rest}`;
  if (kind === 'artifact') return `${await ctx.artifactPath(name)}${rest}`;
  if (kind === 'unpacked') return `${await ctx.unpacked(name)}${rest}`;
  if (kind === 'env') {
    const value = process.env[name];
    if (!value) throw new Error(`set ${name} to run this pack script`);
    return `${value}${rest}`;
  }
  throw new Error(`unknown placeholder ${arg}`);
}

async function upstream(ctx, recipe) {
  const path = await pinned(recipe.pin, ctx.pinOptions);
  return { path, install: recipe.format ? archive(recipe.format, recipe.stripComponents) : ctx.fileInstall };
}

async function resignArchive(ctx, recipe) {
  const root = join(ctx.stage, 'root');
  await extract(await pinned(recipe.pin, ctx.pinOptions), recipe.source, root);
  const entries = await listEntries(root);
  await signTree(root, entries, { identity: ctx.identity });
  const path = join(ctx.stage, ctx.file);
  await packTarZst({ root, out: path, layout: recipe.layout, entries });
  return { path, install: archive('tar.zst', recipe.stripComponents) };
}

async function pack(ctx, recipe) {
  const root = join(ctx.stage, 'root');
  for (const file of recipe.files) {
    const target = join(root, file.path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(await pinned(file.pin, ctx.pinOptions), target);
  }
  for (const file of recipe.generated ?? []) {
    const text = GENERATORS[file.by](await readFile(join(root, file.from), 'utf8'));
    const target = join(root, file.path);
    await writeFile(target, text);
    await checkPin(target, file, `${ctx.id}: generated ${file.path}`);
  }
  const path = join(ctx.stage, ctx.file);
  await packTarZst({ root, out: path, layout: recipe.layout, compressionLevel: recipe.compressionLevel });
  return { path, install: archive('tar.zst') };
}

async function script(ctx, recipe) {
  const command = [];
  for (const arg of recipe.command) command.push(await placeholder(ctx, arg));
  const env = recipe.identity ? { TAALCUT_MAC_IDENTITY: ctx.identity } : {};
  const summary = lastJson(await runScript(ctx, command, env));
  // A script that makes one file (a Linux whisper binary) names it as `file`; the manifest's install spec stays.
  if (typeof summary.file === 'string' && ctx.fileInstall)
    return { path: resolve(ctx.repo, summary.file), install: ctx.fileInstall };
  if (typeof summary.archive !== 'string') throw new Error(`${ctx.id}: the pack script named no archive`);
  return { path: resolve(ctx.repo, summary.archive), install: archive('tar.zst') };
}

async function whisper(ctx, recipe) {
  ctx.memo.whisper ??= runScript(ctx, ['bash', 'tools/whisper/build.sh'], {
    TAALCUT_MAC_IDENTITY: ctx.identity,
  });
  await ctx.memo.whisper;
  const path = join(ctx.stage, ctx.file);
  await copyFile(join(ctx.repo, 'tools', 'whisper', 'dist', recipe.binary), path);
  return { path, install: ctx.fileInstall };
}

async function shell(ctx) {
  const entitlements = join(ctx.repo, 'tools', 'components', 'entitlements', 'chrome-headless-shell.plist');
  const stdout = await runScript(
    ctx,
    ['node', 'packages/render/scripts/fetch-shell.mjs', '--pack', '--sign', '--entitlements', entitlements],
    { TAALCUT_MAC_IDENTITY: ctx.identity },
  );
  return { path: lastJson(stdout).archive, install: archive('tar.zst') };
}

/** Crates that publish no licence file: their licence's own text (alloc-stdlib's from its repository). */
async function crateFallback(ctx) {
  const apache = await readFile(await pinned(TEXTS.apache2, ctx.pinOptions), 'utf8');
  const bsd = await readFile(await pinned(TEXTS.allocStdlib, ctx.pinOptions), 'utf8');
  const c2pa = join(ctx.repo, 'native', 'c2pa-sidecar', 'LICENSES');
  const c2paTexts = [
    {
      name: 'LICENSE-MIT (native/c2pa-sidecar/LICENSES)',
      text: await readFile(join(c2pa, 'c2pa-LICENSE-MIT'), 'utf8'),
    },
    {
      name: 'LICENSE-APACHE (native/c2pa-sidecar/LICENSES)',
      text: await readFile(join(c2pa, 'c2pa-LICENSE-APACHE'), 'utf8'),
    },
  ];
  return (pkg) => {
    if (pkg.name === 'c2pa') return c2paTexts;
    if (pkg.name === 'alloc-stdlib') return [{ name: 'LICENSE (from the crate repository)', text: bsd }];
    if (/Apache-2\.0/.test(pkg.license ?? ''))
      return [{ name: 'Apache-2.0 (the licence text; the crate ships no licence file)', text: apache }];
    return undefined;
  };
}

/** Where each target's sidecar is built and staged (LNX1-CMP: linux-x64 in a pinned container, unsigned). */
const C2PA_BUILDS = {
  'aarch64-apple-darwin': {
    command: ['sh', 'native/c2pa-sidecar/build.sh'],
    stage: 'dist/stage',
    sign: true,
  },
  'x86_64-unknown-linux-gnu': {
    command: ['sh', 'tools/components/linux/build-c2pa.sh'],
    stage: 'target/linux-x64/stage',
    sign: false,
  },
};

async function c2pa(ctx, recipe) {
  const crate = join(ctx.repo, 'native', 'c2pa-sidecar');
  const target = recipe.target ?? 'aarch64-apple-darwin';
  const build = C2PA_BUILDS[target];
  if (!build) throw new Error(`c2pa-sidecar: no build for ${target}`);
  await runScript(ctx, build.command);
  const root = join(ctx.stage, 'root');
  await cp(join(crate, build.stage), root, { recursive: true, verbatimSymlinks: true });
  if (build.sign) await signFile(join(root, 'taalcut-c2pa'), { identity: ctx.identity });
  const crates = await cargoNotice(crate, { platform: target, fallback: await crateFallback(ctx) });
  await writeFile(join(root, 'LICENSES', 'THIRD-PARTY-CRATES.txt'), crates);
  ctx.log(`c2pa-sidecar: crate notice ${sha256Hex(crates).slice(0, 12)}`);
  const path = join(ctx.stage, ctx.file);
  await packTarZst({ root, out: path, layout: recipe.layout });
  return { path, install: archive('tar.zst') };
}

export const RECIPES = {
  upstream,
  'resign-archive': resignArchive,
  pack,
  script,
  whisper,
  shell,
  c2pa,
};
