// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The licence sections of Deno's NOTICE (build-component.mjs calls denoNoticeSections for `notice.generated:
 * 'deno'`), generated from the pinned Deno release's Cargo.lock and nothing looked up at build time:
 * - every crate deno links (cargo tree for aarch64-apple-darwin, normal edges, no procedural macros), with its own
 *   licence files; a path crate with its workspace's and every licence file inside it; a crate that publishes none
 *   with its repository's (licences.json, by sha256) or, where that has none either, its declared licence's text;
 * - the licence files of the native code native crates build in (pins.mjs, NATIVE);
 * - V8 as rusty_v8's static library compiles it, and the Rust crates of its Temporal support (V8_FILES, gn.mjs);
 * - the Rust standard library of Deno's toolchain;
 * - the notices of third-party code in Deno's own source (embedded.mjs), quoted as they stand, and their licences.
 * It fails on anything nobody has reviewed: a native crate missing from NATIVE (or one NATIVE names that is gone), a
 * crate with no licence file and no entry in licences.json (or a stale entry), a Temporal crate list or a V8 commit
 * licences.json doesn't have, a copyright holder EMBEDDED doesn't know.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract } from '../hosting/archive.mjs';
import { pinned } from '../hosting/pinned.mjs';
import { TEXTS } from '../hosting/texts.mjs';
import { isNative, licenceFilesIn, nestedLicenceFiles } from './cargo.mjs';
import { embeddedNotices, noticeTexts } from './embedded.mjs';
import { gnRustClosure } from './gn.mjs';
import { DENO, EMBEDDED, NATIVE, RUST_STD, V8_FILES, V8_TEMPORAL } from './pins.mjs';
import { embeddedSection, groupSections, textSections, Texts } from './render.mjs';
import { linkedWorkspaces } from './source.mjs';

const LICENCES = join(dirname(fileURLToPath(import.meta.url)), 'licences.json');
const read = (path) => readFile(path, 'utf8');
const key = (crate) => `${crate.name}@${crate.version}`;

/** A crate's own licence files; a path crate's, if its folder has none, from the nearest folder up to `root`. */
async function ownFiles(crate, root) {
  for (let dir = crate.dir; ; dir = dirname(dir)) {
    const names = await licenceFilesIn(dir);
    if (names.length > 0)
      return Promise.all(
        names.map(async (name) => ({
          name: dir === crate.dir ? name : `${relative(root, join(dir, name))} (its workspace's)`,
          text: await read(join(dir, name)),
        })),
      );
    if (crate.registry || dir === root || !dir.startsWith(root)) return [];
  }
}

/** The index item of one crate: its licence files, and why they are those. */
async function crateItem(crate, { root, licences, missing, native: reviewed = {}, pinOptions }) {
  const item = {
    label: `${crate.name} ${crate.version}  ${crate.license ?? '(no licence field)'}`,
    id: `${crate.name} ${crate.version}`,
    files: [],
  };
  const notes = [];
  item.files.push(...(await ownFiles(crate, root)));
  const upstream = licences.crates[key(crate)];
  if (upstream && item.files.length > 0)
    throw new Error(`${key(crate)}: has licence files; licences.json's entry is stale`);
  if (item.files.length === 0 && Array.isArray(upstream)) {
    for (const file of upstream)
      item.files.push({
        name: `${file.file} in ${file.from}`,
        text: await read(await pinned(file, pinOptions)),
      });
    notes.push('publishes no licence file; its repository’s are quoted');
  } else if (item.files.length === 0 && upstream) {
    const apache = /Apache-2\.0/.test(crate.license ?? '');
    const text = apache ? TEXTS.apache2 : licences.texts.mit;
    item.files.push({
      name: apache ? 'the Apache-2.0 text' : 'the MIT text',
      text: await read(await pinned(text, pinOptions)),
    });
    const authors = crate.authors.length > 0 ? `, authors ${crate.authors.join(', ')}` : '';
    notes.push(
      `publishes no licence file, nor does its repository: Cargo.toml says ${crate.license}${authors}`,
    );
  } else if (item.files.length === 0 && missing) {
    item.files.push(...missing.files);
    notes.push(missing.note);
  }
  if (item.files.length === 0) throw new Error(`${key(crate)}: no licence file; run deno/discover.mjs`);
  if (!crate.registry)
    for (const path of await nestedLicenceFiles(crate.dir))
      item.files.push({ name: `${path} (inside it)`, text: await read(join(crate.dir, path)) });
  const native = reviewed[crate.name];
  if (native) {
    for (const path of native.paths) item.files.push({ name: path, text: await read(join(crate.dir, path)) });
    notes.push(`builds in: ${native.why}`);
  }
  if (notes.length > 0) item.note = notes.join('; ');
  return item;
}

/** Throws unless `reviewed` (NATIVE) names exactly the native crates deno links. */
export function checkNative(crates, reviewed = NATIVE) {
  const native = crates.filter(isNative).map((crate) => crate.name);
  const missing = native.filter((name) => !reviewed[name]);
  const gone = Object.keys(reviewed).filter((name) => !native.includes(name));
  if (missing.length + gone.length > 0)
    throw new Error(
      `deno/pins.mjs NATIVE: review ${missing.join(', ') || '-'}; no longer linked: ${gone.join(', ') || '-'}`,
    );
}

/** Throws unless licences.json's crate entries are exactly the linked crates that publish no licence file. */
export function checkUpstream(crates, licences) {
  const linked = new Set(crates.filter((crate) => crate.registry).map(key));
  const stale = Object.keys(licences.crates).filter((name) => !linked.has(name));
  if (stale.length > 0)
    throw new Error(`licences.json names crates deno no longer links: ${stale.join(', ')}`);
}

/** The V8 group: V8_FILES as licences.json pins them, and the Temporal crates' own licence files. */
async function v8Group(v8, licences, work, pinOptions) {
  const vcs = JSON.parse(await read(join(v8.dir, '.cargo_vcs_info.json')));
  if (vcs.git.sha1 !== licences.v8.commit)
    throw new Error(`v8 ${v8.version} is from ${vcs.git.sha1}; licences.json has ${licences.v8.commit}`);
  const closure = (await gnRustClosure(v8.dir, V8_TEMPORAL)).map(key).join(' ');
  const pinnedClosure = licences.v8.temporal.map(key).join(' ');
  if (closure !== pinnedClosure)
    throw new Error(`V8's Temporal crates are now ${closure}; licences.json has ${pinnedClosure}`);
  const why = new Map(
    V8_FILES.flatMap((entry) =>
      entry.url ? [[entry.file, entry.why]] : entry.files.map((file) => [`${entry.repo}:${file}`, entry.why]),
    ),
  );
  const items = [];
  for (const file of licences.v8.files) {
    const where = file.repo === undefined ? file.file : `${file.repo || 'rusty_v8'}: ${file.file}`;
    items.push({
      label: where,
      note: why.get(file.repo === undefined ? file.file : `${file.repo}:${file.file}`),
      files: [{ name: file.file, text: await read(await pinned(file, pinOptions)) }],
    });
  }
  for (const crate of licences.v8.temporal) {
    const into = join(work, 'temporal', key(crate));
    await extract(await pinned(crate, pinOptions), 'tar.gz', into);
    const dir = join(into, `${crate.name}-${crate.version}`);
    const names = await licenceFilesIn(dir);
    if (names.length === 0)
      throw new Error(`${key(crate)} (V8's Temporal support): no licence file in its .crate`);
    items.push({
      label: `${crate.name} ${crate.version} (Rust, in V8's Temporal support)`,
      id: `${crate.name} ${crate.version} (in V8)`,
      files: await Promise.all(names.map(async (name) => ({ name, text: await read(join(dir, name)) }))),
    });
  }
  return items;
}

/** The licence sections of Deno's notice, and a summary for the log. */
export async function denoNoticeSections({ pinOptions = {} } = {}) {
  const licences = JSON.parse(await read(LICENCES));
  const work = await mkdtemp(join(tmpdir(), 'taalcut-deno-notice-'));
  try {
    const ws = await linkedWorkspaces(work, pinOptions);
    checkNative(ws.denoCrates);
    checkUpstream([...ws.denoCrates, ...ws.stdCrates], licences);
    const texts = new Texts();
    const rustFiles = await Promise.all(
      licences.rust.map(async (file) => ({
        name: `rust-lang/rust ${RUST_STD.repository.ref}: ${file.file}`,
        text: await read(await pinned(file, pinOptions)),
      })),
    );
    const denoItems = [];
    for (const crate of ws.denoCrates)
      denoItems.push(await crateItem(crate, { root: ws.deno, licences, native: NATIVE, pinOptions }));
    const v8 = ws.denoCrates.find((crate) => crate.name === 'v8');
    const v8Items = await v8Group(v8, licences, work, pinOptions);
    const stdItems = [];
    const missing = {
      root: ws.std,
      files: rustFiles,
      note: "part of the Rust project, under its repository's licence",
    };
    for (const crate of ws.stdCrates)
      stdItems.push(await crateItem(crate, { root: ws.std, licences, missing, pinOptions }));
    const sections = groupSections(
      [
        {
          title: `Deno ${DENO.version}: every Rust crate linked into it, and the native code those crates build in`,
          intro: [
            `From deno ${DENO.version}'s Cargo.lock (tag commit ${DENO.commit}): cargo tree -p deno --target ${DENO.target} -e normal,no-proc-macro. Each crate is listed with its licence expression and the numbers of the texts below that apply to it: its own licence files, or, for Deno's own crates, the workspace's LICENSE.md and every licence file inside the crate. Where a crate offers a choice of licences, Taalcut distributes it under any of the options whose texts are quoted.`,
          ],
          items: denoItems,
        },
        {
          title: `V8 as rusty_v8 ${v8.version}'s static library compiles it (the v8 crate)`,
          intro: [
            `The v8 crate links rusty_v8's prebuilt static library (rusty_v8 ${licences.v8.commit}). It holds V8, rusty_v8's own code, and the libraries V8 compiles in with rusty_v8's build arguments on macOS arm64; their licence files at the commits rusty_v8 pins follow, then the Rust crates of V8's Temporal support (from the v8 crate's BUILD.gn files), each with its own licence files. glibc's sin and cos are under the LGPL-2.1-or-later: their source is in the v8 crate, hosted beside this file.`,
          ],
          items: v8Items,
        },
        {
          title: `The Rust standard library (toolchain ${DENO.toolchain}), linked into every Rust binary`,
          intro: [
            `cargo tree -p ${RUST_STD.root} --features ${RUST_STD.features.join(',')} in the toolchain's rust-src: the library's own crates, under the rust-lang/rust repository's licence, and the crates it uses.`,
          ],
          items: stdItems,
        },
      ],
      texts,
    );
    const notices = noticeTexts(
      await embeddedNotices(
        ws.deno,
        ws.denoCrates.filter((c) => !c.registry).map((c) => c.dir),
      ),
      EMBEDDED,
    );
    const quoted = [];
    for (const { notice, texts: ids } of notices) {
      const numbers = [];
      for (const id of ids)
        numbers.push(
          texts.add(await read(await pinned(licences.texts[id], pinOptions)), licences.texts[id].title),
        );
      quoted.push({ notice, numbers: [...new Set(numbers)] });
    }
    sections.push(
      embeddedSection(
        "Third-party code in Deno's own source, by the notices its files begin with",
        "Deno's own crates carry code from Node.js, TypeScript, type definitions and other projects. Each distinct first comment naming a copyright holder other than the Deno authors is quoted as it stands, with the files it heads and the numbers of the licence texts it refers to.",
        quoted,
      ),
      ...textSections(texts),
    );
    return {
      sections,
      summary: `${ws.denoCrates.length} crates, ${v8Items.length} V8 entries, ${ws.stdCrates.length} std crates, ${notices.length} embedded notices, ${texts.list.length} distinct texts`,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
