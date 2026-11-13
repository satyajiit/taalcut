// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Deno's notice generator: what it reads from cargo and GN, what it finds in Deno's own source, how it numbers
// texts, and the reviews it refuses to skip. Cargo itself is not run here; release builds run it.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { isNative, licenceFilesIn, linkedCrates, nestedLicenceFiles, parseTree } from './cargo.mjs';
import { embeddedNotices, foreignCopyrights, leadingComment, noticeTexts } from './embedded.mjs';
import { gnRustClosure, parseGnCrate } from './gn.mjs';
import { checkNative, checkUpstream } from './notice.mjs';
import { groupSections, textSections, Texts, wrap } from './render.mjs';

const temps = [];
const temp = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deno-notice-'));
  temps.push(dir);
  return dir;
};
after(() => Promise.all(temps.map((dir) => rm(dir, { recursive: true, force: true }))));

describe('cargo', () => {
  const metadata = {
    packages: [
      {
        id: 'root',
        name: 'deno',
        version: '2.9.6',
        license: 'MIT',
        source: null,
        manifest_path: '/s/cli/Cargo.toml',
        targets: [],
      },
      {
        id: 'z',
        name: 'libz-sys',
        version: '1.1.20',
        license: 'MIT OR Apache-2.0',
        links: 'z',
        source: 'registry',
        manifest_path: '/r/libz-sys-1.1.20/Cargo.toml',
        authors: ['A'],
      },
      {
        id: 'cc',
        name: 'cc',
        version: '1.0.0',
        license: 'MIT',
        source: 'registry',
        manifest_path: '/r/cc-1.0.0/Cargo.toml',
      },
      {
        id: 'p',
        name: 'psm',
        version: '0.1.21',
        license: 'MIT',
        source: 'registry',
        manifest_path: '/r/psm/Cargo.toml',
      },
    ],
    resolve: {
      nodes: [
        { id: 'root', deps: [{ pkg: 'z', dep_kinds: [{ kind: null }] }] },
        { id: 'p', deps: [{ pkg: 'cc', dep_kinds: [{ kind: 'build' }] }] },
      ],
    },
  };

  it('reads cargo tree once per crate, path and git suffixes and repeats included', () => {
    const tree = parseTree(
      'deno v2.9.6 (/s/cli)\nlibz-sys v1.1.20\npsm v0.1.21\nlibz-sys v1.1.20 (*)\n\nx v1.0.0 (https://g/x#abc)\n',
    );
    assert.deepEqual(
      tree.map((c) => `${c.name}@${c.version}`),
      ['deno@2.9.6', 'libz-sys@1.1.20', 'psm@0.1.21', 'x@1.0.0'],
    );
  });

  it('joins the tree with metadata, root included, and tells native crates apart', () => {
    const crates = linkedCrates(metadata, parseTree('deno v2.9.6 (/s/cli)\npsm v0.1.21\nlibz-sys v1.1.20'));
    assert.deepEqual(
      crates.map((c) => [c.name, c.registry, c.dir, isNative(c)]),
      [
        ['deno', false, '/s/cli', false],
        ['libz-sys', true, '/r/libz-sys-1.1.20', true],
        ['psm', true, '/r/psm', true],
      ],
    );
    assert.deepEqual(crates[1].authors, ['A']);
    assert.deepEqual(crates[2].nativeBuild, ['cc']);
    assert.throws(() => linkedCrates(metadata, parseTree('gone v1.0.0')), /gone 1.0.0: 0 packages/);
  });

  it('finds licence files at the top and nested, never in tests or examples', async () => {
    const dir = await temp();
    for (const path of [
      'LICENSE-MIT',
      'COPYRIGHT',
      'README.md',
      'vendor/zlib/LICENSE',
      'tests/LICENSE',
      'examples/a/COPYING',
    ])
      await mkdir(join(dir, path, '..'), { recursive: true }).then(() => writeFile(join(dir, path), 'x'));
    assert.deepEqual(await licenceFilesIn(dir), ['COPYRIGHT', 'LICENSE-MIT']);
    assert.deepEqual(await nestedLicenceFiles(dir), ['vendor/zlib/LICENSE']);
  });
});

describe('gn', () => {
  const files = {
    'third_party/rust/temporal_capi/BUILD.gn':
      'group("temporal_capi") {\n  public_deps = [ "//third_party/rust/temporal_capi/v0_2:lib" ]\n}\n',
    'third_party/rust/temporal_capi/v0_2/BUILD.gn': [
      'cargo_crate("lib") {',
      '  crate_type = "rlib"',
      '  cargo_pkg_name = "temporal_capi"',
      '  cargo_pkg_version = "0.2.3"',
      '  deps = [',
      '    "//third_party/rust/diplomat/v0_15:lib",',
      '    "//third_party/rust/icu/v2:lib",',
      '  ]',
      '  if (is_win) {',
      '    deps += [ "//third_party/rust/windows_sys/v0_59:lib" ]',
      '  }',
      '  if (!is_win) {',
      '    deps += [ "//third_party/rust/gimli/v0_32:lib" ]',
      '  }',
      '}',
    ].join('\n'),
    'third_party/rust/diplomat/v0_15/BUILD.gn':
      'cargo_crate("lib") {\n  crate_type = "proc-macro"\n  cargo_pkg_name = "diplomat"\n  cargo_pkg_version = "0.15.1"\n  deps = [ "//third_party/rust/syn/v2:lib" ]\n}\n',
    'third_party/rust/icu/v2/BUILD.gn':
      'cargo_crate("lib") {\n  cargo_pkg_name = "icu_calendar"\n  cargo_pkg_version = "2.2.1"\n}\n',
    'third_party/rust/gimli/v0_32/BUILD.gn':
      'cargo_crate("lib") {\n  cargo_pkg_name = "gimli"\n  cargo_pkg_version = "0.32.3"\n}\n',
  };
  const read = async (path) => files[path.replace(/^\/v8\//, '')] ?? assert.fail(`read ${path}`);

  it('reads a crate target, keeping deps another platform only adds out', () => {
    const crate = parseGnCrate(files['third_party/rust/temporal_capi/v0_2/BUILD.gn']);
    assert.equal(crate.name, 'temporal_capi');
    assert.deepEqual(crate.deps, [
      '//third_party/rust/diplomat/v0_15:lib',
      '//third_party/rust/icu/v2:lib',
      '//third_party/rust/gimli/v0_32:lib',
    ]);
  });

  it('follows a group and leaves procedural macros and their deps out', async () => {
    const closure = await gnRustClosure('/v8', '//third_party/rust/temporal_capi', read);
    assert.deepEqual(
      closure.map((c) => `${c.name}@${c.version}`),
      ['gimli@0.32.3', 'icu_calendar@2.2.1', 'temporal_capi@0.2.3'],
    );
  });
});

describe("Deno's own source", () => {
  it('reads the first comment of a file, line comments or a block', () => {
    assert.equal(leadingComment('#!/usr/bin/env node\n// a\n// b\ncode // c'), '// a\n// b');
    assert.equal(leadingComment('\n/*! x\n y */\ncode'), '/*! x\n y */');
    assert.equal(leadingComment('code\n// late'), '');
  });

  it("keeps copyright lines that are not the Deno authors' and not the MIT text's", () => {
    const comment = [
      '// Copyright 2018-2026 the Deno authors. MIT license.',
      '// Copyright Joyent, Inc. and other Node contributors.',
      '// The above copyright notice and this permission notice shall be included',
      '// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE',
    ].join('\n');
    assert.deepEqual(foreignCopyrights(comment), ['Copyright Joyent, Inc. and other Node contributors.']);
  });

  it('groups files by their notice and maps holders to texts, refusing unknown ones', async () => {
    const root = await temp();
    await mkdir(join(root, 'ext/node/tests'), { recursive: true });
    await writeFile(join(root, 'ext/node/a.js'), '// Copyright Joyent. MIT license.\nx');
    await writeFile(join(root, 'ext/node/b.ts'), '// Copyright Joyent. MIT license.\ny');
    await writeFile(join(root, 'ext/node/c.ts'), '// Copyright 2018-2026 the Deno authors. MIT license.\nz');
    await writeFile(join(root, 'ext/node/tests/d.ts'), '// Copyright Someone. GPL.\n');
    await writeFile(
      join(root, 'ext/node/e.d.ts'),
      '/*! Copyright (c) Microsoft Corporation. All rights reserved. */',
    );
    const notices = await embeddedNotices(root, [join(root, 'ext/node')]);
    assert.deepEqual(
      notices.map((n) => n.files),
      [['ext/node/a.js', 'ext/node/b.ts'], ['ext/node/e.d.ts']],
    );
    const embedded = [{ holder: /Microsoft Corporation\. All rights reserved/, texts: ['typescript'] }];
    assert.deepEqual(
      noticeTexts(notices, embedded).map((n) => n.texts),
      [['mit'], ['typescript']],
    );
    const unknown = [
      { comment: '// Copyright Someone. GPL.', holders: ['Copyright Someone. GPL.'], files: ['x'] },
    ];
    assert.throws(() => noticeTexts(unknown, embedded), /no EMBEDDED entry[^]*Copyright Someone/);
  });
});

describe('the reviews', () => {
  const crate = (name, extra = {}) => ({
    name,
    version: '1.0.0',
    links: null,
    nativeBuild: [],
    registry: true,
    ...extra,
  });

  it('fails on a native crate nobody reviewed, and on a review for a crate no longer linked', () => {
    const crates = [crate('libz-sys', { links: 'z' }), crate('psm', { nativeBuild: ['cc'] }), crate('plain')];
    checkNative(crates, { 'libz-sys': {}, psm: {} });
    assert.throws(() => checkNative(crates, { 'libz-sys': {} }), /review psm/);
    assert.throws(() => checkNative(crates, { 'libz-sys': {}, psm: {}, ring: {} }), /no longer linked: ring/);
  });

  it('fails on a licences.json entry for a crate no longer linked', () => {
    checkUpstream([crate('a')], { crates: { 'a@1.0.0': [] } });
    assert.throws(
      () => checkUpstream([crate('a')], { crates: { 'b@2.0.0': [] } }),
      /no longer links: b@2.0.0/,
    );
  });
});

describe('render', () => {
  it('quotes the same text once and lists what it is quoted for', () => {
    const texts = new Texts();
    const [index] = groupSections(
      [
        {
          title: 'Crates',
          intro: ['Intro.'],
          items: [
            { label: 'a 1.0.0  MIT', id: 'a 1.0.0', files: [{ name: 'LICENSE', text: 'MIT text\r\n' }] },
            {
              label: 'b 2.0.0  MIT',
              id: 'b 2.0.0',
              note: 'a note',
              files: [
                { name: 'COPYING', text: 'MIT text' },
                { name: 'NOTICE', text: 'other' },
              ],
            },
          ],
        },
      ],
      texts,
    );
    assert.equal(index.text, 'Intro.\n\na 1.0.0  MIT  texts 1\nb 2.0.0  MIT  texts 1, 2\n    a note');
    const [first, second] = textSections(texts);
    assert.equal(first.title, 'Text 1: a 1.0.0 (LICENSE) and 1 more');
    assert.equal(first.text, 'Quoted for:\na 1.0.0 (LICENSE); b 2.0.0 (COPYING)\n\nMIT text');
    assert.equal(second.title, 'Text 2: b 2.0.0 (NOTICE)');
  });

  it('wraps long lists', () => {
    assert.equal(wrap(['aaaa', 'bbbb', 'cccc'], ', ', 10), 'aaaa, bbbb,\ncccc');
  });
});
