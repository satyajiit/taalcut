#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Resolves the texts Deno's notice quotes from outside its crates into licences.json, for a person to review and
 * commit (the build then fetches them by these pins and never looks anything up):
 * - crates that publish no licence file: their repository's licence files at the commit they were published from
 *   (.cargo_vcs_info.json), from the crate's folder up to the repository's root, nearest first; `none` when the
 *   repository has none either (the notice then quotes the declared licence's own text and says so);
 * - V8_FILES at the submodule commits rusty_v8 pins at the v8 crate's commit, and the .crate packages of the Rust
 *   crates V8's Temporal support compiles in;
 * - the rust-lang/rust licence files for the standard library, and EMBEDDED_TEXTS.
 *
 *   GITHUB_TOKEN=… node tools/components/deno/discover.mjs   (GitHub's API; without a token it is rate-limited)
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { byteOrder } from '../hosting/files.mjs';
import { LICENCE_FILE, licenceFilesIn } from './cargo.mjs';
import { gnRustClosure } from './gn.mjs';
import { EMBEDDED_TEXTS, RUST_STD, UPSTREAM_REPOS, V8_FILES, V8_TEMPORAL } from './pins.mjs';
import { linkedWorkspaces } from './source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'licences.json');
const RUSTY_V8 = 'denoland/rusty_v8';

/** fetch, retried with backoff on a network error or a 5xx (a discovery run makes a few hundred requests). */
async function fetchRetrying(url, init) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.status < 500 || attempt === 5) return response;
    } catch (error) {
      if (attempt === 5) throw error;
    }
    await delay(1000 * 2 ** attempt);
  }
}

async function api(path) {
  const headers = { accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetchRetrying(`https://api.github.com${path}`, { headers });
  if (response.status === 404 || response.status === 422) return undefined;
  if (!response.ok) throw new Error(`GitHub ${path}: HTTP ${response.status}`);
  return response.json();
}

/** Fetches `url` and returns { url, size, sha256 } of its bytes (decoded first for gitiles' base64). */
async function pin(url, encoding) {
  const response = await fetchRetrying(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  let bytes = Buffer.from(await response.arrayBuffer());
  if (encoding === 'base64') bytes = Buffer.from(bytes.toString('utf8').replace(/\s+/g, ''), 'base64');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { url, size: bytes.length, sha256, ...(encoding ? { encoding } : {}) };
}

const githubRepo = (url) => /^https?:\/\/github\.com\/([^/]+\/[^/.#]+)/.exec(url ?? '')?.[1];

/** The licence files in `folder` of `repo` at `ref`, nearest first up to the root, or undefined. */
async function nearestLicences(repo, ref, folder) {
  const folders = folder
    ? folder.split('/').map((_, i, parts) => parts.slice(0, parts.length - i).join('/'))
    : [];
  for (const dir of [...folders, '']) {
    const listing = await api(`/repos/${repo}/contents/${dir}?ref=${ref}`);
    const names = (Array.isArray(listing) ? listing : [])
      .filter((entry) => entry.type === 'file' && LICENCE_FILE.test(entry.name))
      .map((entry) => entry.name)
      .sort(byteOrder);
    if (names.length > 0) return names.map((name) => (dir ? `${dir}/${name}` : name));
  }
  return undefined;
}

/**
 * A crate's licence files in its repository: at the commit it was published from, else at its version's tag, else
 * at the default branch's head (some crates are published from commits never pushed), the commit always recorded.
 */
async function upstreamFiles(crate) {
  const vcs = JSON.parse(await readFile(join(crate.dir, '.cargo_vcs_info.json'), 'utf8').catch(() => 'null'));
  const override = UPSTREAM_REPOS[`${crate.name}@${crate.version}`] ?? {};
  const repo = override.repo ?? githubRepo(crate.repository);
  if (!repo) throw new Error(`${crate.name} ${crate.version}: no GitHub repository; add UPSTREAM_REPOS`);
  const folder = override.path ?? vcs?.path_in_vcs ?? '';
  const head = (await api(`/repos/${repo}`))?.default_branch;
  const candidates = [
    [override.ref ?? vcs?.git?.sha1, 'the commit it was published from'],
    [`v${crate.version}`, `the tag v${crate.version}`],
    [`${crate.name}-v${crate.version}`, `the tag ${crate.name}-v${crate.version}`],
    [`${crate.name}@${crate.version}`, `the tag ${crate.name}@${crate.version}`],
    [head, `the head of ${head} (the published commit is not in the repository)`],
  ];
  for (const [ref, what] of candidates) {
    if (!ref) continue;
    const sha = (await api(`/repos/${repo}/commits/${encodeURIComponent(ref)}`))?.sha;
    if (!sha) continue;
    const files = await nearestLicences(repo, sha, folder);
    if (!files) continue;
    return Promise.all(
      files.map(async (file) => ({
        file,
        from: `${repo} at ${what}`,
        ...(await pin(`https://raw.githubusercontent.com/${repo}/${sha}/${file}`)),
      })),
    );
  }
  return { none: `no licence file in ${repo} at any of those commits`, declared: crate.license };
}

/** Where a rusty_v8 submodule's file is served: GitHub raw, or gitiles base64. */
async function v8File(commit, repo, file) {
  let base = { url: `https://github.com/${RUSTY_V8}`, sha: commit };
  if (repo) {
    const entry = await api(`/repos/${RUSTY_V8}/contents/${repo}?ref=${commit}`);
    if (entry?.type !== 'submodule') throw new Error(`rusty_v8 ${repo}: not a submodule at ${commit}`);
    base = { url: entry.submodule_git_url.replace(/\.git$/, ''), sha: entry.sha };
  }
  const github = githubRepo(base.url);
  if (github) return pin(`https://raw.githubusercontent.com/${github}/${base.sha}/${file}`);
  return pin(`${base.url}/+/${base.sha}/${file}?format=TEXT`, 'base64');
}

/** crates.io's .crate for name@version, with the sha256 its index records. */
async function cratePin(name, version) {
  const lower = name.toLowerCase();
  const prefix =
    lower.length <= 2
      ? `${lower.length}`
      : lower.length === 3
        ? `3/${lower[0]}`
        : `${lower.slice(0, 2)}/${lower.slice(2, 4)}`;
  const index = await (await fetchRetrying(`https://index.crates.io/${prefix}/${lower}`)).text();
  const line = index
    .split('\n')
    .filter(Boolean)
    .map((text) => JSON.parse(text))
    .find((entry) => entry.vers === version);
  if (!line) throw new Error(`${name} ${version}: not in crates.io's index`);
  const crate = await pin(`https://static.crates.io/crates/${name}/${name}-${version}.crate`);
  if (crate.sha256 !== line.cksum)
    throw new Error(`${name} ${version}: the .crate is not the one the index names`);
  return { name, version, ...crate };
}

const work = await mkdtemp(join(tmpdir(), 'taalcut-deno-discover-'));
try {
  const { denoCrates, stdCrates } = await linkedWorkspaces(work, {});
  const crates = {};
  for (const crate of [...denoCrates, ...stdCrates].filter((c) => c.registry)) {
    if ((await licenceFilesIn(crate.dir)).length > 0) continue;
    const found = await upstreamFiles(crate);
    crates[`${crate.name}@${crate.version}`] = found;
    console.error(`upstream: ${crate.name} ${crate.version}${found.none ? `: ${found.none}` : ''}`);
  }
  const v8 = denoCrates.find((crate) => crate.name === 'v8');
  const vcs = JSON.parse(await readFile(join(v8.dir, '.cargo_vcs_info.json'), 'utf8'));
  const v8Files = [];
  for (const entry of V8_FILES) {
    if (entry.url) v8Files.push({ file: entry.file, ...(await pin(entry.url)) });
    else
      for (const file of entry.files)
        v8Files.push({ repo: entry.repo, file, ...(await v8File(vcs.git.sha1, entry.repo, file)) });
  }
  const temporal = [];
  for (const { name, version } of await gnRustClosure(v8.dir, V8_TEMPORAL))
    temporal.push(await cratePin(name, version));
  const { url, ref, files } = RUST_STD.repository;
  const rust = [];
  for (const file of files)
    rust.push({
      file,
      ...(await pin(`https://raw.githubusercontent.com/${githubRepo(url)}/${ref}/${file}`)),
    });
  const texts = {};
  for (const [id, text] of Object.entries(EMBEDDED_TEXTS))
    texts[id] = { title: text.title, ...(await pin(text.url)) };
  const out = { crates, v8: { commit: vcs.git.sha1, files: v8Files, temporal }, rust, texts };
  await writeFile(OUT, `${JSON.stringify(out, null, 2)}\n`);
  // Formatted as the repository's prettier formats it, so a rerun with nothing changed leaves no diff.
  execFileSync(join(HERE, '..', '..', '..', 'node_modules', '.bin', 'prettier'), ['--write', OUT]);
  console.error(
    `wrote ${OUT}: ${Object.keys(crates).length} crates, ${v8Files.length} V8 files, ${temporal.length} Temporal crates`,
  );
} finally {
  await rm(work, { recursive: true, force: true });
}
